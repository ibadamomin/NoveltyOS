// Two-phone cloud sync tests against a real Postgres database with the Supabase schema and row-level security.
// Run: tests/run-cloud-tests.sh  (needs a local Postgres; see README)
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import pg from 'pg';
import * as D from '../src/lib/db.ts';
import { syncOnce, type Remote } from '../src/lib/sync.ts';

// ---- a "phone": real SQLite with the expo-sqlite API surface the app uses
function phone() {
  const raw = new DatabaseSync(':memory:');
  const norm = (p: any[]) => (p.length === 1 && Array.isArray(p[0]) ? p[0] : p).map((v: any) => (v === undefined ? null : v));
  const db: any = {
    execAsync: async (s: string) => raw.exec(s),
    runAsync: async (s: string, ...p: any[]) => { const r = raw.prepare(s).run(...norm(p)); return { lastInsertRowId: Number(r.lastInsertRowid), changes: r.changes }; },
    getAllAsync: async (s: string, ...p: any[]) => raw.prepare(s).all(...norm(p)),
    getFirstAsync: async (s: string, ...p: any[]) => raw.prepare(s).get(...norm(p)) ?? null,
    withTransactionAsync: async (f: any) => { raw.exec('BEGIN'); try { await f(); raw.exec('COMMIT'); } catch (e) { raw.exec('ROLLBACK'); throw e; } },
  };
  db.withExclusiveTransactionAsync = (f: any) => db.withTransactionAsync(() => f(db));
  return db;
}

// ---- the cloud: real Postgres, every query run as a signed-in user under row-level security
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5433/novelty' });
async function asUser<T>(uid: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query('set local role authenticated');
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated' })]);
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); }
}
function pgRemote(uid: string, businessId: string): Remote {
  return {
    async upsert(table, rows) {
      await asUser(uid, async (c) => {
        for (const r of rows) {
          const cols = [...Object.keys(r), 'business_id'];
          const vals = [...Object.values(r), businessId];
          const pk = table === 'settings' ? 'business_id, key' : 'business_id, id';
          const upd = Object.keys(r).map((k) => `${k} = excluded.${k}`).join(', ');
          await c.query(`insert into ${table} (${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')}) on conflict (${pk}) do update set ${upd}`, vals);
        }
      });
    },
    async pull(table, since, offset, limit) {
      return asUser(uid, async (c) => {
        const { rows } = await c.query(`select * from ${table} where business_id = $1 and server_updated_at >= $2 order by server_updated_at, ${table === 'settings' ? 'key' : 'id'} offset $3 limit $4`, [businessId, since, offset, limit]);
        return rows.map((r: any) => ({ ...r, server_updated_at: r.server_updated_at.toISOString(), cost: num(r.cost), price: num(r.price), subtotal: num(r.subtotal), tax: num(r.tax), total: num(r.total), paid: num(r.paid), amount: num(r.amount), opening_balance: num(r.opening_balance), unit_price: num(r.unit_price), unit_cost: num(r.unit_cost) }));
      });
    },
  };
}
const num = (v: any) => (v == null ? v : Number(v)); // PostgREST returns bigint as JSON numbers too

// ---- users
const owner = crypto.randomUUID(), clerk = crypto.randomUUID(), stranger = crypto.randomUUID();
await pool.query(`insert into auth.users (id, email) values ($1,'owner@x'),($2,'clerk@x'),($3,'stranger@x')`, [owner, clerk, stranger]);

const biz = await asUser(owner, async (c) => (await c.query(`select * from create_business('Garage Goodies')`)).rows[0]);
const joined = await asUser(clerk, async (c) => (await c.query(`select * from join_business($1)`, [biz.invite_code.toLowerCase()])).rows[0]);
assert.equal(joined.id, biz.id, 'clerk joined with invite code (case-insensitive)');
await assert.rejects(asUser(stranger, (c) => c.query(`select * from join_business('NOPE1234')`)), /Invite code not found/);

const A = phone(), B = phone();
await D.migrate(A); await D.migrate(B);
const rA = pgRemote(owner, biz.id), rB = pgRemote(clerk, biz.id);

// Phone A works offline first, then links to the cloud
await D.saveSettings(A, { ...D.DEFAULT_SETTINGS, businessName: 'Garage Goodies', taxRate: '0' });
const sup = await D.saveParty(A, { type: 'supplier', name: 'Wholesale Co', phone: '', opening_balance: 0 });
const maria = await D.saveParty(A, { type: 'customer', name: 'Maria', phone: '', opening_balance: 1200 });
const slime = await D.saveProduct(A, { name: 'Slime', barcode: '111', cost: 0, price: 0, qty: 0, low_stock: 3 });
await D.createInvoice(A, { kind: 'purchase', party_id: sup, taxRate: 0, paid: 2000, method: 'cash', lines: [
  { product_id: slime, name: 'Slime', barcode: '111', qty: 20, unit_price: 175, unit_cost: 175, new_sell_price: 499 }] });
let r = await syncOnce(A, rA);
assert.ok(r.pushed > 0); assert.equal(await D.countUnsynced(A), 0);

// Phone B (the clerk) downloads everything
r = await syncOnce(B, rB);
assert.ok(r.pulled > 0);
assert.equal((await D.findByBarcode(B, '111'))!.qty, 20);
assert.equal((await D.findByBarcode(B, '111'))!.price, 499);
assert.equal((await D.getSettings(B)).businessName, 'Garage Goodies');
assert.equal((await D.getParty(B, sup))!.balance, 1500, 'B sees we owe supplier 15.00');

// Both phones sell the same product while offline
const sell = (db: any, qty: number, party: string | null, paid: number) => D.createInvoice(db, { kind: 'sale', party_id: party, taxRate: 0, paid, method: 'cash',
  lines: [{ product_id: slime, name: 'Slime', barcode: '111', qty, unit_price: 499, unit_cost: 175 }] });
await sell(A, 3, maria, 1000);   // Maria: 12.00 + 14.97 - 10.00 = 16.97
const walkB = await sell(B, 2, null, 998);
await D.recordPayment(B, { party_id: maria, direction: 'in', amount: 500, method: 'cash', note: '' }); // -> 11.97
await syncOnce(A, rA); await syncOnce(B, rB); await syncOnce(A, rA);
for (const [name, db] of [['A', A], ['B', B]] as const) {
  assert.equal((await D.findByBarcode(db, '111'))!.qty, 15, `${name}: 20 - 3 - 2 = 15, neither sale lost`);
  assert.equal((await D.getParty(db, maria))!.balance, 1197, `${name}: Maria's balance agrees`);
  const s = await D.getSummary(db, '2000-01-01');
  assert.equal(s.salesTotal, 499 * 5); assert.equal(s.cashIn, 1000 + 998 + 500); assert.equal(s.cashOut, 2000);
}

// Void on B, price edit + stock recount on A
await D.voidInvoice(B, walkB);
const p = (await D.getProduct(A, slime))!;
await D.saveProduct(A, { ...p, price: 550, qty: 16 }); // counted 16 on the shelf (before seeing the void)
await syncOnce(B, rB); await syncOnce(A, rA); await syncOnce(B, rB);
for (const db of [A, B]) {
  const q = (await D.getProduct(db, slime))!;
  assert.equal(q.price, 550);
  assert.equal(q.qty, 18, 'void (+2) and recount correction (+1) both survive');
  assert.equal((await D.getSummary(db, '2000-01-01')).salesTotal, 499 * 3);
}

// Conflicting edits of the same customer: last upload wins, and both phones end up identical
await D.saveParty(B, { id: maria, type: 'customer', name: 'Maria Lopez', phone: '', opening_balance: 1200 });
await D.saveParty(A, { id: maria, type: 'customer', name: 'Maria L.', phone: '555', opening_balance: 1200 });
await syncOnce(B, rB); await syncOnce(A, rA); await syncOnce(B, rB);
assert.equal((await D.getParty(A, maria))!.name, 'Maria L.');
assert.equal((await D.getParty(B, maria))!.name, 'Maria L.');

// An edit made on the phone *while* a download is running is kept, then uploaded next time
await D.saveParty(B, { id: maria, type: 'customer', name: 'Maria (B)', phone: '', opening_balance: 1200 });
await syncOnce(B, rB);
const sneaky: Remote = {
  upsert: rA.upsert,
  pull: async (table, since, off, lim) => {
    const rows = await rA.pull(table, since, off, lim);
    if (table === 'parties') await D.saveParty(A, { id: maria, type: 'customer', name: 'Maria (A, mid-sync)', phone: '', opening_balance: 1200 });
    return rows;
  },
};
await syncOnce(A, sneaky);
assert.equal((await D.getParty(A, maria))!.name, 'Maria (A, mid-sync)', 'local edit not clobbered by download');
assert.ok((await D.countUnsynced(A)) > 0);
await syncOnce(A, rA); await syncOnce(B, rB);
assert.equal((await D.getParty(B, maria))!.name, 'Maria (A, mid-sync)');
assert.equal(await D.countUnsynced(A), 0);

// Deleting syncs too
await D.deletePayment(B, (await D.partyLedger(B, maria)).find((e) => e.type === 'payment')!.id);
await syncOnce(B, rB); await syncOnce(A, rA);
assert.equal((await D.getParty(A, maria))!.balance, 1697, 'payment deleted on B is gone on A');

// A third phone joining later gets the full, identical picture
const C = phone(); await D.migrate(C); await syncOnce(C, rB);
assert.equal((await D.getProduct(C, slime))!.qty, 18);
assert.equal((await D.getParty(C, maria))!.balance, 1697);
assert.deepEqual(await D.getSummary(C, '2000-01-01'), await D.getSummary(A, '2000-01-01'));

// Security: a stranger sees nothing and cannot write into the business
const leaked = await asUser(stranger, async (c) => (await c.query('select count(*)::int n from products')).rows[0].n);
assert.equal(leaked, 0, 'stranger reads 0 rows');
await assert.rejects(pgRemote(stranger, biz.id).upsert('products', [{ id: 'evil', barcode: null, name: 'x', cost: 0, price: 0, low_stock: 0, created_at: 'x', updated_at: 'x', deleted: 0 }]), /row-level security/);
await assert.rejects(asUser(stranger, (c) => c.query(`update products set price = 1 where business_id = $1 returning 1`, [biz.id]).then((x) => { if (x.rowCount) throw new Error('row-level security bypassed'); throw new Error('row-level security: 0 rows'); })), /row-level security: 0 rows/);
assert.equal((await asUser(stranger, (c) => c.query('select * from businesses'))).rowCount, 0);
await assert.rejects(asUser(clerk, (c) => c.query(`select rotate_invite_code($1)`, [biz.id])), /Only the owner/);
await assert.rejects(asUser(clerk, (c) => c.query(`delete from products where business_id = $1`, [biz.id]).then((x) => { if (x.rowCount) throw new Error('deleted!'); throw new Error('no delete'); })), /no delete/);

// Account deletion: staff leaving keeps the business; the owner leaving removes it and all its records
await assert.rejects(asUser(stranger, (c) => c.query('select public.delete_my_account()')).then(() => { throw new Error('ran'); }).catch((e) => { if (e.message === 'ran') throw new Error('ok'); throw e; }), /ok/); // stranger with no business: allowed, deletes only themselves
assert.equal((await pool.query('select count(*)::int n from auth.users where id = $1', [stranger])).rows[0].n, 0);
await asUser(clerk, (c) => c.query('select public.delete_my_account()'));
assert.equal((await pool.query('select count(*)::int n from members where user_id = $1', [clerk])).rows[0].n, 0, 'clerk membership gone');
assert.equal((await pool.query('select count(*)::int n from products where business_id = $1', [biz.id])).rows[0].n, 1, 'business data kept when staff leaves');
await asUser(owner, (c) => c.query('select public.delete_my_account()'));
for (const t of ['businesses', 'products', 'invoices', 'invoice_items', 'payments', 'parties', 'settings', 'stock_adjustments']) {
  const col = t === 'businesses' ? 'id' : 'business_id';
  assert.equal((await pool.query(`select count(*)::int n from ${t} where ${col} = $1`, [biz.id])).rows[0].n, 0, `${t} deleted with owner`);
}
assert.equal((await pool.query('select count(*)::int n from auth.users where id = $1', [owner])).rows[0].n, 0, 'owner login deleted');
await assert.rejects(pool.query(`set role anon; select public.delete_my_account()`).finally(() => pool.query('reset role')), /permission denied/);

console.log('ALL CLOUD SYNC TESTS PASSED');
await pool.end();
