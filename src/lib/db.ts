import type { SQLiteDatabase } from 'expo-sqlite';

/*
 * Local, offline-first database.
 *
 * Every synced row has:
 *   id          globally unique text id (so phones never clash)
 *   updated_at  when this phone last changed it
 *   deleted     soft-delete flag (deletes must sync too)
 *   dirty       1 = changed on this phone and not yet uploaded
 *
 * Stock on hand is never stored. It is calculated from purchases, sales and
 * manual adjustments, so two phones selling at once can never overwrite each other.
 * Balances are calculated the same way.
 */

export type Product = {
  id: string;
  barcode: string | null;
  name: string;
  cost: number; // cents, last purchase cost
  price: number; // cents, selling price
  qty: number; // computed
  low_stock: number;
  created_at: string;
};

export type PartyType = 'customer' | 'supplier';

export type Party = {
  id: string;
  type: PartyType;
  name: string;
  phone: string;
  opening_balance: number;
  created_at: string;
  /** customer: what they owe you. supplier: what you owe them. */
  balance: number;
};

export type InvoiceKind = 'sale' | 'purchase';
export type PayMethod = 'cash' | 'card' | 'other';

export type Invoice = {
  id: string;
  number: string;
  kind: InvoiceKind;
  party_id: string | null;
  party_name: string | null;
  date: string;
  subtotal: number;
  tax: number;
  total: number;
  paid: number;
  method: PayMethod;
  note: string;
};

export type InvoiceItem = {
  id: string;
  invoice_id: string;
  product_id: string | null;
  name: string;
  barcode: string | null;
  qty: number;
  unit_price: number;
  unit_cost: number;
};

export type Payment = {
  id: string;
  party_id: string;
  direction: 'in' | 'out';
  amount: number;
  method: PayMethod;
  date: string;
  note: string;
};

export type Settings = {
  businessName: string;
  address: string;
  phone: string;
  email: string;
  taxRate: string; // percent as text, e.g. "8.25"
  currency: string;
  footer: string;
};

export const DEFAULT_SETTINGS: Settings = {
  businessName: 'My Business',
  address: '',
  phone: '',
  email: '',
  taxRate: '0',
  currency: '$',
  footer: 'Thank you for your business!',
};

/** Tables that sync to the cloud, in upload order, with their columns (excluding `dirty`). */
export const SYNC_TABLES = {
  settings: ['key', 'value', 'updated_at'],
  products: ['id', 'barcode', 'name', 'cost', 'price', 'low_stock', 'created_at', 'updated_at', 'deleted'],
  parties: ['id', 'type', 'name', 'phone', 'opening_balance', 'created_at', 'updated_at', 'deleted'],
  invoices: ['id', 'number', 'kind', 'party_id', 'date', 'subtotal', 'tax', 'total', 'paid', 'method', 'note', 'updated_at', 'deleted'],
  invoice_items: ['id', 'invoice_id', 'product_id', 'name', 'barcode', 'qty', 'unit_price', 'unit_cost', 'updated_at', 'deleted'],
  payments: ['id', 'party_id', 'direction', 'amount', 'method', 'date', 'note', 'updated_at', 'deleted'],
  stock_adjustments: ['id', 'product_id', 'delta', 'reason', 'date', 'updated_at', 'deleted'],
} as const;
export type SyncTable = keyof typeof SYNC_TABLES;
export const primaryKey = (t: SyncTable) => (t === 'settings' ? 'key' : 'id');

const now = () => new Date().toISOString();

export function newId(): string {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function newNumber(kind: InvoiceKind): string {
  const d = new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no look-alikes (0/O, 1/I)
  let tail = '';
  for (let i = 0; i < 4; i++) tail += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `${kind === 'sale' ? 'INV' : 'PO'}-${ymd}-${tail}`;
}

export function invoiceNumber(inv: Pick<Invoice, 'number'>) {
  return inv.number;
}

// ---------------------------------------------------------------------------
// Change notifications (drives auto-sync and screen refreshes)
// ---------------------------------------------------------------------------

type Listener = (source: 'local' | 'remote') => void;
const listeners = new Set<Listener>();
export function onDataChange(l: Listener) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
export function emitDataChange(source: 'local' | 'remote') {
  listeners.forEach((l) => l(source));
}
const changed = () => emitDataChange('local');

type Txn = Pick<SQLiteDatabase, 'runAsync' | 'getFirstAsync' | 'getAllAsync'>;

/** Atomic write. Uses an exclusive transaction on phones; the web preview only supports the basic one. */
export function transaction(db: SQLiteDatabase, task: (txn: Txn) => Promise<void>) {
  if (process.env.EXPO_OS === 'web') return db.withTransactionAsync(() => task(db));
  return db.withExclusiveTransactionAsync(task);
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SYNC_COLS = `updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, dirty INTEGER NOT NULL DEFAULT 1`;

export async function migrate(db: SQLiteDatabase) {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL,
      updated_at TEXT NOT NULL, dirty INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY NOT NULL,
      barcode TEXT,
      name TEXT NOT NULL,
      cost INTEGER NOT NULL DEFAULT 0,
      price INTEGER NOT NULL DEFAULT 0,
      low_stock INTEGER NOT NULL DEFAULT 3,
      created_at TEXT NOT NULL,
      ${SYNC_COLS}
    );
    CREATE TABLE IF NOT EXISTS parties (
      id TEXT PRIMARY KEY NOT NULL,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      opening_balance INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      ${SYNC_COLS}
    );
    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY NOT NULL,
      number TEXT NOT NULL,
      kind TEXT NOT NULL,
      party_id TEXT,
      date TEXT NOT NULL,
      subtotal INTEGER NOT NULL,
      tax INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL,
      paid INTEGER NOT NULL,
      method TEXT NOT NULL DEFAULT 'cash',
      note TEXT NOT NULL DEFAULT '',
      ${SYNC_COLS}
    );
    CREATE TABLE IF NOT EXISTS invoice_items (
      id TEXT PRIMARY KEY NOT NULL,
      invoice_id TEXT NOT NULL,
      product_id TEXT,
      name TEXT NOT NULL,
      barcode TEXT,
      qty INTEGER NOT NULL,
      unit_price INTEGER NOT NULL,
      unit_cost INTEGER NOT NULL DEFAULT 0,
      ${SYNC_COLS}
    );
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY NOT NULL,
      party_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      amount INTEGER NOT NULL,
      method TEXT NOT NULL DEFAULT 'cash',
      date TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      ${SYNC_COLS}
    );
    CREATE TABLE IF NOT EXISTS stock_adjustments (
      id TEXT PRIMARY KEY NOT NULL,
      product_id TEXT NOT NULL,
      delta INTEGER NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL,
      ${SYNC_COLS}
    );
    CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
    CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(date);
    CREATE INDEX IF NOT EXISTS idx_invoices_party ON invoices(party_id);
    CREATE INDEX IF NOT EXISTS idx_items_invoice ON invoice_items(invoice_id);
    CREATE INDEX IF NOT EXISTS idx_items_product ON invoice_items(product_id);
    CREATE INDEX IF NOT EXISTS idx_payments_party ON payments(party_id);
    CREATE INDEX IF NOT EXISTS idx_adj_product ON stock_adjustments(product_id);
  `);
}

export async function getMeta(db: SQLiteDatabase, key: string): Promise<string | null> {
  return (await db.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', key))?.value ?? null;
}

export async function setMeta(db: SQLiteDatabase, key: string, value: string | null) {
  if (value == null) await db.runAsync('DELETE FROM meta WHERE key = ?', key);
  else await db.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', key, value);
}

/** Erase all business data on this phone (used when switching or leaving a cloud business). */
export async function wipeLocalData(db: SQLiteDatabase) {
  await db.withTransactionAsync(async () => {
    for (const t of Object.keys(SYNC_TABLES)) await db.runAsync(`DELETE FROM ${t}`);
    await db.runAsync("DELETE FROM meta WHERE key IN ('business_id', 'last_pull')");
  });
  emitDataChange('remote');
}

/** Flag everything as not-yet-uploaded (used when this phone's data is first linked to a cloud business). */
export async function markAllDirty(db: SQLiteDatabase, includeSettings: boolean) {
  for (const t of Object.keys(SYNC_TABLES)) {
    if (t === 'settings' && !includeSettings) continue;
    await db.runAsync(`UPDATE ${t} SET dirty = 1`);
  }
}

export async function hasLocalData(db: SQLiteDatabase) {
  for (const t of ['products', 'parties', 'invoices', 'payments'] as const) {
    if (await db.getFirstAsync(`SELECT 1 FROM ${t} WHERE deleted = 0 LIMIT 1`)) return true;
  }
  return false;
}

export async function countUnsynced(db: SQLiteDatabase) {
  let n = 0;
  for (const t of Object.keys(SYNC_TABLES)) {
    n += (await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t} WHERE dirty = 1`))?.n ?? 0;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function getSettings(db: SQLiteDatabase): Promise<Settings> {
  const rows = await db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM settings');
  const s: Settings = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    if (r.key in s) (s as Record<string, string>)[r.key] = r.value;
  }
  return s;
}

export async function saveSettings(db: SQLiteDatabase, s: Settings) {
  const current = await getSettings(db);
  await db.withTransactionAsync(async () => {
    for (const [key, value] of Object.entries(s)) {
      if ((current as Record<string, string>)[key] === value) continue;
      await db.runAsync('INSERT OR REPLACE INTO settings (key, value, updated_at, dirty) VALUES (?, ?, ?, 1)', key, value, now());
    }
  });
  changed();
}

export function taxRatePercent(s: Settings): number {
  const n = Number(s.taxRate);
  return isFinite(n) && n > 0 ? n : 0;
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

const PRODUCT_SELECT = `
  SELECT p.id, p.barcode, p.name, p.cost, p.price, p.low_stock, p.created_at,
    IFNULL((SELECT SUM(CASE i.kind WHEN 'purchase' THEN it.qty ELSE -it.qty END)
            FROM invoice_items it JOIN invoices i ON i.id = it.invoice_id
            WHERE it.product_id = p.id AND it.deleted = 0 AND i.deleted = 0), 0)
    + IFNULL((SELECT SUM(delta) FROM stock_adjustments a WHERE a.product_id = p.id AND a.deleted = 0), 0) AS qty
  FROM products p`;

export function listProducts(db: SQLiteDatabase, search = '') {
  const q = `%${search.trim()}%`;
  return db.getAllAsync<Product>(
    `${PRODUCT_SELECT} WHERE p.deleted = 0 AND (p.name LIKE ? OR IFNULL(p.barcode,'') LIKE ?) ORDER BY p.name COLLATE NOCASE`,
    q,
    q,
  );
}

export function getProduct(db: SQLiteDatabase, id: string) {
  return db.getFirstAsync<Product>(`${PRODUCT_SELECT} WHERE p.id = ? AND p.deleted = 0`, id);
}

export function findByBarcode(db: SQLiteDatabase, barcode: string) {
  return db.getFirstAsync<Product>(
    `${PRODUCT_SELECT} WHERE p.barcode = ? AND p.deleted = 0 ORDER BY p.created_at LIMIT 1`,
    barcode.trim(),
  );
}

export async function saveProduct(
  db: SQLiteDatabase,
  p: Omit<Product, 'id' | 'created_at'> & { id?: string },
): Promise<string> {
  const barcode = p.barcode?.trim() || null;
  if (barcode) {
    const clash = await db.getFirstAsync<{ name: string }>(
      'SELECT name FROM products WHERE barcode = ? AND id != ? AND deleted = 0',
      barcode,
      p.id ?? '',
    );
    if (clash) throw new Error(`Barcode already used by "${clash.name}".`);
  }
  const t = now();
  const id = p.id ?? newId();
  await transaction(db, async (txn) => {
    let currentQty = 0;
    if (p.id) {
      currentQty = (await txn.getFirstAsync<{ qty: number }>(`SELECT qty FROM (${PRODUCT_SELECT}) WHERE id = ?`, id))?.qty ?? 0;
      await txn.runAsync(
        'UPDATE products SET barcode=?, name=?, cost=?, price=?, low_stock=?, updated_at=?, dirty=1 WHERE id=?',
        barcode,
        p.name.trim(),
        p.cost,
        p.price,
        p.low_stock,
        t,
        id,
      );
    } else {
      await txn.runAsync(
        'INSERT INTO products (id, barcode, name, cost, price, low_stock, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)',
        id,
        barcode,
        p.name.trim(),
        p.cost,
        p.price,
        p.low_stock,
        t,
        t,
      );
    }
    const delta = p.qty - currentQty;
    if (delta !== 0) {
      await txn.runAsync(
        'INSERT INTO stock_adjustments (id, product_id, delta, reason, date, updated_at) VALUES (?,?,?,?,?,?)',
        newId(),
        id,
        delta,
        p.id ? 'Count correction' : 'Starting stock',
        t,
        t,
      );
    }
  });
  changed();
  return id;
}

export async function deleteProduct(db: SQLiteDatabase, id: string) {
  await db.runAsync('UPDATE products SET deleted = 1, dirty = 1, updated_at = ? WHERE id = ?', now(), id);
  changed();
}

export type ProductMovement = {
  invoice_id: string | null;
  kind: InvoiceKind | 'adjustment';
  date: string;
  qty: number;
  unit_price: number;
  party_name: string | null;
};

export function productHistory(db: SQLiteDatabase, productId: string) {
  return db.getAllAsync<ProductMovement>(
    `SELECT * FROM (
       SELECT i.id AS invoice_id, i.kind, i.date, it.qty, it.unit_price, p.name AS party_name
       FROM invoice_items it JOIN invoices i ON i.id = it.invoice_id
       LEFT JOIN parties p ON p.id = i.party_id
       WHERE it.product_id = ? AND it.deleted = 0 AND i.deleted = 0
       UNION ALL
       SELECT NULL, 'adjustment', a.date, a.delta, 0, a.reason
       FROM stock_adjustments a WHERE a.product_id = ? AND a.deleted = 0
     ) ORDER BY date DESC LIMIT 100`,
    productId,
    productId,
  );
}

// ---------------------------------------------------------------------------
// Customers & suppliers
// ---------------------------------------------------------------------------

const PARTY_SELECT = `
  SELECT p.id, p.type, p.name, p.phone, p.opening_balance, p.created_at,
    p.opening_balance
    + IFNULL((SELECT SUM(total - paid) FROM invoices WHERE party_id = p.id AND deleted = 0), 0)
    - IFNULL((SELECT SUM(amount) FROM payments WHERE party_id = p.id AND deleted = 0), 0) AS balance
  FROM parties p`;

export function listParties(db: SQLiteDatabase, type: PartyType, search = '') {
  return db.getAllAsync<Party>(
    `${PARTY_SELECT} WHERE p.deleted = 0 AND p.type = ? AND (p.name LIKE ? OR p.phone LIKE ?) ORDER BY p.name COLLATE NOCASE`,
    type,
    `%${search.trim()}%`,
    `%${search.trim()}%`,
  );
}

export function getParty(db: SQLiteDatabase, id: string) {
  return db.getFirstAsync<Party>(`${PARTY_SELECT} WHERE p.id = ? AND p.deleted = 0`, id);
}

export async function saveParty(
  db: SQLiteDatabase,
  p: { id?: string; type: PartyType; name: string; phone: string; opening_balance: number },
): Promise<string> {
  const t = now();
  if (p.id) {
    await db.runAsync(
      'UPDATE parties SET name=?, phone=?, opening_balance=?, updated_at=?, dirty=1 WHERE id=?',
      p.name.trim(),
      p.phone.trim(),
      p.opening_balance,
      t,
      p.id,
    );
    changed();
    return p.id;
  }
  const id = newId();
  await db.runAsync(
    'INSERT INTO parties (id, type, name, phone, opening_balance, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
    id,
    p.type,
    p.name.trim(),
    p.phone.trim(),
    p.opening_balance,
    t,
    t,
  );
  changed();
  return id;
}

export async function deleteParty(db: SQLiteDatabase, id: string) {
  const t = now();
  await db.withTransactionAsync(async () => {
    await db.runAsync('UPDATE parties SET deleted = 1, dirty = 1, updated_at = ? WHERE id = ?', t, id);
    await db.runAsync('UPDATE payments SET deleted = 1, dirty = 1, updated_at = ? WHERE party_id = ?', t, id);
  });
  changed();
}

export type LedgerEntry = {
  type: 'invoice' | 'payment';
  id: string;
  date: string;
  /** amount added to balance (invoice total) */
  charge: number;
  /** amount removed from balance (paid at sale or later payment) */
  credit: number;
  method: PayMethod;
  label: string;
};

export async function partyLedger(db: SQLiteDatabase, partyId: string): Promise<LedgerEntry[]> {
  const invoices = await db.getAllAsync<Invoice>('SELECT * FROM invoices WHERE party_id = ? AND deleted = 0', partyId);
  const payments = await db.getAllAsync<Payment>('SELECT * FROM payments WHERE party_id = ? AND deleted = 0', partyId);
  const entries: LedgerEntry[] = [
    ...invoices.map((i) => ({
      type: 'invoice' as const,
      id: i.id,
      date: i.date,
      charge: i.total,
      credit: i.paid,
      method: i.method,
      label: i.number,
    })),
    ...payments.map((p) => ({
      type: 'payment' as const,
      id: p.id,
      date: p.date,
      charge: 0,
      credit: p.amount,
      method: p.method,
      label: p.direction === 'in' ? 'Payment received' : 'Payment made',
    })),
  ];
  return entries.sort((a, b) => b.date.localeCompare(a.date));
}

export async function recordPayment(
  db: SQLiteDatabase,
  p: { party_id: string; direction: 'in' | 'out'; amount: number; method: PayMethod; note: string },
) {
  const t = now();
  await db.runAsync(
    'INSERT INTO payments (id, party_id, direction, amount, method, date, note, updated_at) VALUES (?,?,?,?,?,?,?,?)',
    newId(),
    p.party_id,
    p.direction,
    p.amount,
    p.method,
    t,
    p.note,
    t,
  );
  changed();
}

export async function deletePayment(db: SQLiteDatabase, id: string) {
  await db.runAsync('UPDATE payments SET deleted = 1, dirty = 1, updated_at = ? WHERE id = ?', now(), id);
  changed();
}

// ---------------------------------------------------------------------------
// Invoices (sales & purchases) — these move stock
// ---------------------------------------------------------------------------

export type LineInput = {
  product_id: string;
  name: string;
  barcode: string | null;
  qty: number;
  unit_price: number; // sale: selling price; purchase: cost
  unit_cost: number; // cost basis (for profit on sales)
  new_sell_price?: number; // purchase only: update the product's selling price
};

export async function createInvoice(
  db: SQLiteDatabase,
  inv: {
    kind: InvoiceKind;
    party_id: string | null;
    lines: LineInput[];
    taxRate: number;
    paid: number;
    method: PayMethod;
    note?: string;
  },
): Promise<string> {
  const subtotal = inv.lines.reduce((s, l) => s + l.qty * l.unit_price, 0);
  const tax = inv.kind === 'sale' ? Math.round((subtotal * inv.taxRate) / 100) : 0;
  const total = subtotal + tax;
  const id = newId();
  const t = now();

  await transaction(db, async (txn) => {
    await txn.runAsync(
      'INSERT INTO invoices (id, number, kind, party_id, date, subtotal, tax, total, paid, method, note, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      id,
      newNumber(inv.kind),
      inv.kind,
      inv.party_id,
      t,
      subtotal,
      tax,
      total,
      inv.paid,
      inv.method,
      inv.note ?? '',
      t,
    );
    for (const l of inv.lines) {
      await txn.runAsync(
        'INSERT INTO invoice_items (id, invoice_id, product_id, name, barcode, qty, unit_price, unit_cost, updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
        newId(),
        id,
        l.product_id,
        l.name,
        l.barcode,
        l.qty,
        l.unit_price,
        l.unit_cost,
        t,
      );
      if (inv.kind === 'purchase') {
        // Remember the latest cost (and new selling price, if given).
        const price = l.new_sell_price && l.new_sell_price > 0 ? l.new_sell_price : null;
        await txn.runAsync(
          'UPDATE products SET cost = ?, price = COALESCE(?, price), updated_at = ?, dirty = 1 WHERE id = ?',
          l.unit_price,
          price,
          t,
          l.product_id,
        );
      }
    }
  });
  changed();
  return id;
}

/** Cancels an invoice. Stock and balances reverse automatically because they are calculated. */
export async function voidInvoice(db: SQLiteDatabase, id: string) {
  const t = now();
  await transaction(db, async (txn) => {
    await txn.runAsync('UPDATE invoice_items SET deleted = 1, dirty = 1, updated_at = ? WHERE invoice_id = ?', t, id);
    await txn.runAsync('UPDATE invoices SET deleted = 1, dirty = 1, updated_at = ? WHERE id = ?', t, id);
  });
  changed();
}

export async function getInvoice(db: SQLiteDatabase, id: string) {
  const inv = await db.getFirstAsync<Invoice>(
    `SELECT i.*, p.name AS party_name FROM invoices i LEFT JOIN parties p ON p.id = i.party_id WHERE i.id = ? AND i.deleted = 0`,
    id,
  );
  if (!inv) return null;
  const items = await db.getAllAsync<InvoiceItem>(
    'SELECT * FROM invoice_items WHERE invoice_id = ? AND deleted = 0 ORDER BY rowid',
    id,
  );
  return { invoice: inv, items };
}

export function listInvoices(db: SQLiteDatabase, kind: InvoiceKind | 'all', search = '') {
  const q = `%${search.trim()}%`;
  return db.getAllAsync<Invoice>(
    `SELECT i.*, p.name AS party_name FROM invoices i LEFT JOIN parties p ON p.id = i.party_id
     WHERE i.deleted = 0 AND (? = 'all' OR i.kind = ?) AND (IFNULL(p.name,'') LIKE ? OR i.number LIKE ?)
     ORDER BY i.date DESC LIMIT 300`,
    kind,
    kind,
    q,
    q,
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export type Summary = {
  salesTotal: number;
  salesCount: number;
  profit: number;
  cashIn: number;
  cashOut: number;
  receivable: number;
  payable: number;
  stockValue: number;
  lowStock: Product[];
};

export function startOfToday(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function getSummary(db: SQLiteDatabase, since: string): Promise<Summary> {
  const sales = await db.getFirstAsync<{ total: number; n: number }>(
    `SELECT IFNULL(SUM(total),0) AS total, COUNT(*) AS n FROM invoices WHERE kind='sale' AND deleted = 0 AND date >= ?`,
    since,
  );
  const profit = await db.getFirstAsync<{ v: number }>(
    `SELECT IFNULL(SUM(it.qty * (it.unit_price - it.unit_cost)),0) AS v
     FROM invoice_items it JOIN invoices i ON i.id = it.invoice_id
     WHERE i.kind='sale' AND i.deleted = 0 AND it.deleted = 0 AND i.date >= ?`,
    since,
  );
  const cash = await db.getFirstAsync<{ cin: number; cout: number }>(
    `SELECT
       IFNULL((SELECT SUM(paid) FROM invoices WHERE kind='sale' AND method='cash' AND deleted = 0 AND date >= ?),0)
       + IFNULL((SELECT SUM(amount) FROM payments WHERE direction='in' AND method='cash' AND deleted = 0 AND date >= ?),0) AS cin,
       IFNULL((SELECT SUM(paid) FROM invoices WHERE kind='purchase' AND method='cash' AND deleted = 0 AND date >= ?),0)
       + IFNULL((SELECT SUM(amount) FROM payments WHERE direction='out' AND method='cash' AND deleted = 0 AND date >= ?),0) AS cout`,
    since,
    since,
    since,
    since,
  );
  const balances = await db.getAllAsync<{ type: PartyType; balance: number }>(
    `SELECT type, balance FROM (${PARTY_SELECT} WHERE p.deleted = 0)`,
  );
  const products = await db.getAllAsync<Product>(`${PRODUCT_SELECT} WHERE p.deleted = 0`);
  const lowStock = products
    .filter((p) => p.qty <= p.low_stock)
    .sort((a, b) => a.qty - b.qty || a.name.localeCompare(b.name))
    .slice(0, 20);
  return {
    salesTotal: sales?.total ?? 0,
    salesCount: sales?.n ?? 0,
    profit: profit?.v ?? 0,
    cashIn: cash?.cin ?? 0,
    cashOut: cash?.cout ?? 0,
    receivable: balances.filter((b) => b.type === 'customer' && b.balance > 0).reduce((s, b) => s + b.balance, 0),
    payable: balances.filter((b) => b.type === 'supplier' && b.balance > 0).reduce((s, b) => s + b.balance, 0),
    stockValue: products.reduce((s, p) => s + Math.max(p.qty, 0) * p.cost, 0),
    lowStock,
  };
}

export async function partyBalance(db: SQLiteDatabase, partyId: string): Promise<number> {
  return (await getParty(db, partyId))?.balance ?? 0;
}
