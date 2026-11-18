// Bookkeeping tests: purchases, sales, payments, voids, tax, profit and cash, run against real SQLite.
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import * as D from '../src/lib/db.ts';

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

await D.migrate(db);
await D.migrate(db); // idempotent

const sup = await D.saveParty(db, { type: 'supplier', name: 'Novelty Wholesale', phone: '', opening_balance: 0 });
const joe = await D.saveParty(db, { type: 'customer', name: 'Joe', phone: '555', opening_balance: 500 });
const slime = await D.saveProduct(db, { name: 'Slime Jar', barcode: '012345678905', cost: 0, price: 0, qty: 0, low_stock: 3 });
const spin = await D.saveProduct(db, { name: 'Spinner', barcode: 'QR-SPIN', cost: 0, price: 0, qty: 0, low_stock: 3 });
await assert.rejects(D.saveProduct(db, { name: 'Dup', barcode: '012345678905', cost: 0, price: 0, qty: 0, low_stock: 3 }), /already used/);

// Purchase: 10 slime @2.50 (sell 5), 5 spinners @1.20 (sell 3) = 31.00, paid 20 cash
const po = await D.createInvoice(db, { kind: 'purchase', party_id: sup, taxRate: 0, paid: 2000, method: 'cash', lines: [
  { product_id: slime, name: 'Slime Jar', barcode: '012345678905', qty: 10, unit_price: 250, unit_cost: 250, new_sell_price: 500 },
  { product_id: spin, name: 'Spinner', barcode: 'QR-SPIN', qty: 5, unit_price: 120, unit_cost: 120, new_sell_price: 300 },
]});
assert.equal((await D.findByBarcode(db, '012345678905'))!.qty, 10);
assert.equal((await D.getProduct(db, slime))!.price, 500);
assert.equal((await D.getParty(db, sup))!.balance, 1100, 'we owe supplier 11.00');

// Sale to Joe: 3 slime + 1 spinner = 18.00, paid 10 cash -> Joe owes 5 + 8 = 13
await D.createInvoice(db, { kind: 'sale', party_id: joe, taxRate: 0, paid: 1000, method: 'cash', lines: [
  { product_id: slime, name: 'Slime Jar', barcode: null, qty: 3, unit_price: 500, unit_cost: 250 },
  { product_id: spin, name: 'Spinner', barcode: null, qty: 1, unit_price: 300, unit_cost: 120 },
]});
assert.equal((await D.getParty(db, joe))!.balance, 1300);

// Walk-in: 2 slime paid in cash
const walk = await D.createInvoice(db, { kind: 'sale', party_id: null, taxRate: 0, paid: 1000, method: 'cash', lines: [
  { product_id: slime, name: 'Slime Jar', barcode: null, qty: 2, unit_price: 500, unit_cost: 250 },
]});

// Payments
await D.recordPayment(db, { party_id: joe, direction: 'in', amount: 1300, method: 'cash', note: '' });
await D.recordPayment(db, { party_id: sup, direction: 'out', amount: 1100, method: 'cash', note: '' });
assert.equal((await D.getParty(db, joe))!.balance, 0);
assert.equal((await D.getParty(db, sup))!.balance, 0);

let s = await D.getSummary(db, '2000-01-01');
assert.equal(s.salesTotal, 2800); assert.equal(s.salesCount, 2);
assert.equal(s.profit, 1430);
assert.equal(s.cashIn, 3300); assert.equal(s.cashOut, 3100);
assert.equal(s.stockValue, 5 * 250 + 4 * 120);
assert.equal(s.receivable, 0); assert.equal(s.payable, 0);
console.log('summary', s.salesTotal, s.profit, s.cashIn, s.cashOut, s.stockValue);

// Void walk-in sale -> stock back
await D.voidInvoice(db, walk);
assert.equal((await D.getProduct(db, slime))!.qty, 7);
s = await D.getSummary(db, '2000-01-01');
assert.equal(s.salesTotal, 1800); assert.equal(s.cashIn, 2300);

// Void purchase -> stock removed, supplier balance drops below 0 (we paid 31 for nothing = credit)
const ledger = await D.partyLedger(db, joe);
assert.equal(ledger.length, 2);

// Tax: 8.25% on 10.00 = 0.83
const t = await D.createInvoice(db, { kind: 'sale', party_id: null, taxRate: 8.25, paid: 1083, method: 'card', lines: [
  { product_id: slime, name: 'Slime Jar', barcode: null, qty: 2, unit_price: 500, unit_cost: 250 },
]});
const ti = (await D.getInvoice(db, t))!.invoice;
assert.equal(ti.tax, 83); assert.equal(ti.total, 1083);
s = await D.getSummary(db, '2000-01-01');
assert.equal(s.cashIn, 2300, 'card sale not counted as cash');

// Low stock + history
assert.equal((await D.productHistory(db, slime)).length, 3);
assert.ok(s.lowStock.find((p) => p.name === 'Spinner') === undefined); // 4 > 3
console.log('low stock', s.lowStock.map((p) => `${p.name}:${p.qty}`));

// Settings roundtrip
await D.saveSettings(db, { ...D.DEFAULT_SETTINGS, businessName: 'Garage Goodies', taxRate: '8.25' });
assert.equal((await D.getSettings(db)).businessName, 'Garage Goodies');
console.log('ALL ACCOUNTING TESTS PASSED');
