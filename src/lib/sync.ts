import type { SQLiteDatabase } from 'expo-sqlite';
import { emitDataChange, getMeta, primaryKey, setMeta, SYNC_TABLES, type SyncTable } from './db';

/*
 * Two-way sync between this phone's SQLite database and the cloud.
 *
 * 1. PUSH: upload every row this phone changed (dirty = 1), then clear the flag,
 *    but only if the row wasn't changed again while uploading.
 * 2. PULL: download every row the server changed since the last pull, using the
 *    server's own clock (server_updated_at), so phone clocks never matter. Rows that
 *    were edited on this phone and not yet uploaded are kept.
 *
 * Sales, purchases and payments are only ever added (or voided), and stock and
 * balances are calculated from them, so phones selling at the same time never
 * overwrite each other. Product and customer edits use "last upload wins".
 */

export type Row = Record<string, string | number | null>;

export interface Remote {
  /** Insert or update rows for the business (rows carry no business_id; the remote adds it). */
  upsert(table: SyncTable, rows: Row[]): Promise<void>;
  /** Rows with server_updated_at >= since, ordered by server_updated_at. Must include server_updated_at. */
  pull(table: SyncTable, since: string, offset: number, limit: number): Promise<(Row & { server_updated_at: string })[]>;
}

const PUSH_BATCH = 500;
const PULL_PAGE = 1000;
/** Re-read a short window each time so rows committed slightly out of order are never missed. */
const OVERLAP_MS = 2 * 60 * 1000;

export type SyncResult = { pushed: number; pulled: number };

let running: Promise<SyncResult> | null = null;

/** Runs one sync. Concurrent calls share the same run. */
export function syncOnce(db: SQLiteDatabase, remote: Remote): Promise<SyncResult> {
  if (!running) {
    running = doSync(db, remote).finally(() => {
      running = null;
    });
  }
  return running;
}

async function doSync(db: SQLiteDatabase, remote: Remote): Promise<SyncResult> {
  const pushed = await push(db, remote);
  const pulled = await pull(db, remote);
  if (pulled > 0) emitDataChange('remote');
  return { pushed, pulled };
}

async function push(db: SQLiteDatabase, remote: Remote): Promise<number> {
  let count = 0;
  for (const table of Object.keys(SYNC_TABLES) as SyncTable[]) {
    const cols = SYNC_TABLES[table];
    const pk = primaryKey(table);
    for (;;) {
      const rows = await db.getAllAsync<Row>(
        `SELECT ${cols.join(', ')} FROM ${table} WHERE dirty = 1 LIMIT ${PUSH_BATCH}`,
      );
      if (rows.length === 0) break;
      await remote.upsert(table, rows);
      await db.withTransactionAsync(async () => {
        for (const r of rows) {
          await db.runAsync(`UPDATE ${table} SET dirty = 0 WHERE ${pk} = ? AND updated_at = ?`, r[pk], r.updated_at);
        }
      });
      count += rows.length;
      if (rows.length < PUSH_BATCH) break;
    }
  }
  return count;
}

async function pull(db: SQLiteDatabase, remote: Remote): Promise<number> {
  const lastPull = await getMeta(db, 'last_pull');
  const since = lastPull ? new Date(new Date(lastPull).getTime() - OVERLAP_MS).toISOString() : '1970-01-01T00:00:00.000Z';
  let newest = lastPull;
  let applied = 0;

  for (const table of Object.keys(SYNC_TABLES) as SyncTable[]) {
    const cols = SYNC_TABLES[table];
    const pk = primaryKey(table);
    const placeholders = cols.map(() => '?').join(', ');
    for (let offset = 0; ; offset += PULL_PAGE) {
      const rows = await remote.pull(table, since, offset, PULL_PAGE);
      if (rows.length === 0) break;
      await db.withTransactionAsync(async () => {
        for (const r of rows) {
          const local = await db.getFirstAsync<Row & { dirty: number }>(
            `SELECT ${cols.join(', ')}, dirty FROM ${table} WHERE ${pk} = ?`,
            r[pk],
          );
          if (local?.dirty) continue; // unsent local edit wins; it uploads on the next push
          const values = cols.map((c) => normalize(r[c]));
          // Skip only if every column is already identical (timestamps alone can tie across phones).
          if (local && cols.every((c, i) => normalize(local[c]) === values[i])) continue;
          await db.runAsync(
            `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}, dirty) VALUES (${placeholders}, 0)`,
            ...values,
          );
          applied++;
        }
      });
      for (const r of rows) {
        const ts = new Date(r.server_updated_at).toISOString();
        if (!newest || ts > newest) newest = ts;
      }
      if (rows.length < PULL_PAGE) break;
    }
  }
  if (newest && newest !== lastPull) await setMeta(db, 'last_pull', newest);
  return applied;
}

function normalize(v: unknown): string | number | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number' || typeof v === 'string') return v;
  return String(v);
}
