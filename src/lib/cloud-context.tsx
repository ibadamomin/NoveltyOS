import type { Session } from '@supabase/supabase-js';
import { useSQLiteContext } from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { countUnsynced, getMeta, markAllDirty, onDataChange, setMeta, wipeLocalData } from './db';
import { supabase, supabaseRemote, type Business } from './supabase';
import { syncOnce } from './sync';

export type CloudStatus = 'not-configured' | 'signed-out' | 'no-business' | 'synced' | 'syncing' | 'offline' | 'error';

/** How to treat data already on this phone when linking it to a cloud business. */
export type LinkMode = 'upload-all' | 'merge' | 'replace';

type Ctx = {
  status: CloudStatus;
  session: Session | null;
  business: Business | null;
  lastSynced: string | null;
  error: string | null;
  unsynced: number;
  syncNow: () => Promise<void>;
  linkBusiness: (b: Business, mode: LinkMode) => Promise<void>;
  signOut: () => Promise<void>;
};

const CloudContext = createContext<Ctx | null>(null);

const AUTO_SYNC_DELAY_MS = 2000;
const POLL_MS = 60_000;

export function CloudProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [session, setSession] = useState<Session | null>(null);
  const [business, setBusiness] = useState<Business | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [unsynced, setUnsynced] = useState(0);
  const [ready, setReady] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore login and the linked business.
  useEffect(() => {
    if (!supabase) return;
    let mounted = true;
    (async () => {
      const [{ data }, raw] = await Promise.all([supabase.auth.getSession(), getMeta(db, 'business')]);
      if (!mounted) return;
      setSession(data.session);
      setBusiness(raw ? (JSON.parse(raw) as Business) : null);
      setLastSynced(await getMeta(db, 'last_synced_at'));
      setReady(true);
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [db]);

  const canSync = !!(supabase && session && business);

  const syncNow = useCallback(async () => {
    if (!supabase || !session || !business) return;
    setSyncing(true);
    try {
      await syncOnce(db, supabaseRemote(business.id));
      const at = new Date().toISOString();
      await setMeta(db, 'last_synced_at', at);
      setLastSynced(at);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUnsynced(await countUnsynced(db));
      setSyncing(false);
    }
  }, [db, session, business]);

  // Sync shortly after any local change, every minute, and whenever the app comes back to the front.
  useEffect(() => {
    if (!canSync || !ready) return;
    const first = setTimeout(syncNow, 0);
    const offChange = onDataChange((source) => {
      if (source !== 'local') return;
      countUnsynced(db).then(setUnsynced);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(syncNow, AUTO_SYNC_DELAY_MS);
    });
    const poll = setInterval(() => {
      if (AppState.currentState === 'active') syncNow();
    }, POLL_MS);
    const appState = AppState.addEventListener('change', (s) => {
      if (s === 'active') syncNow();
    });
    return () => {
      clearTimeout(first);
      offChange();
      clearInterval(poll);
      appState.remove();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [canSync, ready, syncNow, db]);

  const linkBusiness = useCallback(
    async (b: Business, mode: LinkMode) => {
      const current = await getMeta(db, 'business_id');
      if (mode === 'replace' || (current && current !== b.id)) {
        await wipeLocalData(db);
      } else if (current !== b.id) {
        // First time this phone joins: upload what it has. When merging into an
        // existing business, keep that business's settings rather than this phone's.
        await markAllDirty(db, mode === 'upload-all');
      }
      await setMeta(db, 'business_id', b.id);
      await setMeta(db, 'business', JSON.stringify(b));
      setBusiness(b);
    },
    [db],
  );

  const signOut = useCallback(async () => {
    await supabase?.auth.signOut();
    await wipeLocalData(db);
    await setMeta(db, 'business', null);
    await setMeta(db, 'last_synced_at', null);
    setBusiness(null);
    setLastSynced(null);
    setUnsynced(0);
    setError(null);
  }, [db]);

  const status: CloudStatus = !supabase
    ? 'not-configured'
    : !session
      ? 'signed-out'
      : !business
        ? 'no-business'
        : syncing
          ? 'syncing'
          : error
            ? /network|fetch|timed? ?out/i.test(error)
              ? 'offline'
              : 'error'
            : 'synced';

  return (
    <CloudContext.Provider value={{ status, session, business, lastSynced, error, unsynced, syncNow, linkBusiness, signOut }}>
      {children}
    </CloudContext.Provider>
  );
}

export function useCloud() {
  const ctx = useContext(CloudContext);
  if (!ctx) throw new Error('useCloud must be used inside CloudProvider');
  return ctx;
}
