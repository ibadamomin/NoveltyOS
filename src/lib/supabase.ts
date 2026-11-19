import 'expo-sqlite/localStorage/install';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import type { SyncTable } from './db';
import type { Remote, Row } from './sync';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/** null when the app was built without cloud settings (it then works fully offline). */
export const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, {
        auth: {
          storage: localStorage,
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false,
        },
      })
    : null;

if (supabase && process.env.EXPO_OS !== 'web') {
  // Only refresh login tokens while the app is open.
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

export type Business = { id: string; name: string; invite_code: string; role?: string };

export async function myBusinesses(): Promise<Business[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('businesses').select('id, name, invite_code').order('created_at');
  if (error) throw error;
  return data ?? [];
}

export async function createBusiness(name: string): Promise<Business> {
  const { data, error } = await supabase!.rpc('create_business', { p_name: name });
  if (error) throw error;
  return data as Business;
}

export async function joinBusiness(code: string): Promise<Business> {
  const { data, error } = await supabase!.rpc('join_business', { p_code: code.trim().toUpperCase() });
  if (error) throw error;
  return data as Business;
}

/** Permanently delete the signed-in user's account (and any business they own, with all its records). */
export async function deleteMyAccount() {
  const { error } = await supabase!.rpc('delete_my_account');
  if (error) throw error;
}

const conflictTarget = (t: SyncTable) => (t === 'settings' ? 'business_id,key' : 'business_id,id');

export function supabaseRemote(businessId: string): Remote {
  const sb = supabase!;
  return {
    async upsert(table, rows) {
      const payload = rows.map((r) => ({ ...r, business_id: businessId }));
      const { error } = await sb.from(table).upsert(payload, { onConflict: conflictTarget(table) });
      if (error) throw new Error(`Upload ${table}: ${error.message}`);
    },
    async pull(table, since, offset, limit) {
      const { data, error } = await sb
        .from(table)
        .select('*')
        .eq('business_id', businessId)
        .gte('server_updated_at', since)
        .order('server_updated_at', { ascending: true })
        .order(table === 'settings' ? 'key' : 'id', { ascending: true })
        .range(offset, offset + limit - 1);
      if (error) throw new Error(`Download ${table}: ${error.message}`);
      return (data ?? []) as (Row & { server_updated_at: string })[];
    },
  };
}
