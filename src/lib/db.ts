import type { SQLiteDatabase } from 'expo-sqlite';

export type Product = {
  id: number;
  barcode: string | null;
  name: string;
  cost: number; // cents, last purchase cost
  price: number; // cents, selling price
  qty: number;
  low_stock: number;
  created_at: string;
};

export type PartyType = 'customer' | 'supplier';

export type Party = {
  id: number;
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
  id: number;
  kind: InvoiceKind;
  party_id: number | null;
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
  id: number;
  invoice_id: number;
  product_id: number | null;
  name: string;
  barcode: string | null;
  qty: number;
  unit_price: number;
  unit_cost: number;
};

export type Payment = {
  id: number;
  party_id: number;
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

const now = () => new Date().toISOString();

type Txn = Pick<SQLiteDatabase, 'runAsync' | 'getFirstAsync' | 'getAllAsync'>;

/** Atomic write. Uses an exclusive transaction on phones; the web preview only supports the basic one. */
function transaction(db: SQLiteDatabase, task: (txn: Txn) => Promise<void>) {
  if (process.env.EXPO_OS === 'web') return db.withTransactionAsync(() => task(db));
  return db.withExclusiveTransactionAsync(task);
}

export function invoiceNumber(inv: Pick<Invoice, 'id' | 'kind'>) {
  return `${inv.kind === 'sale' ? 'INV' : 'PO'}-${String(inv.id).padStart(5, '0')}`;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export async function migrate(db: SQLiteDatabase) {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      barcode TEXT UNIQUE,
      name TEXT NOT NULL,
      cost INTEGER NOT NULL DEFAULT 0,
      price INTEGER NOT NULL DEFAULT 0,
      qty INTEGER NOT NULL DEFAULT 0,
      low_stock INTEGER NOT NULL DEFAULT 3,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS parties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK (type IN ('customer','supplier')),
      name TEXT NOT NULL,
      phone TEXT NOT NULL DEFAULT '',
      opening_balance INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK (kind IN ('sale','purchase')),
      party_id INTEGER REFERENCES parties(id) ON DELETE SET NULL,
      date TEXT NOT NULL,
      subtotal INTEGER NOT NULL,
      tax INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL,
      paid INTEGER NOT NULL,
      method TEXT NOT NULL DEFAULT 'cash',
      note TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      barcode TEXT,
      qty INTEGER NOT NULL,
      unit_price INTEGER NOT NULL,
      unit_cost INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      party_id INTEGER NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
      direction TEXT NOT NULL CHECK (direction IN ('in','out')),
      amount INTEGER NOT NULL,
      method TEXT NOT NULL DEFAULT 'cash',
      date TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(date);
    CREATE INDEX IF NOT EXISTS idx_invoices_party ON invoices(party_id);
    CREATE INDEX IF NOT EXISTS idx_items_invoice ON invoice_items(invoice_id);
    CREATE INDEX IF NOT EXISTS idx_items_product ON invoice_items(product_id);
    CREATE INDEX IF NOT EXISTS idx_payments_party ON payments(party_id);
  `);
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
  await db.withTransactionAsync(async () => {
    for (const [key, value] of Object.entries(s)) {
      await db.runAsync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', key, value);
    }
  });
}

export function taxRatePercent(s: Settings): number {
  const n = Number(s.taxRate);
  return isFinite(n) && n > 0 ? n : 0;
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export function listProducts(db: SQLiteDatabase, search = '') {
  const q = `%${search.trim()}%`;
  return db.getAllAsync<Product>(
    `SELECT * FROM products WHERE name LIKE ? OR IFNULL(barcode,'') LIKE ? ORDER BY name COLLATE NOCASE`,
    q,
    q,
  );
}

export function getProduct(db: SQLiteDatabase, id: number) {
  return db.getFirstAsync<Product>('SELECT * FROM products WHERE id = ?', id);
}

export function findByBarcode(db: SQLiteDatabase, barcode: string) {
  return db.getFirstAsync<Product>('SELECT * FROM products WHERE barcode = ?', barcode.trim());
}

export async function saveProduct(
  db: SQLiteDatabase,
  p: Omit<Product, 'id' | 'created_at'> & { id?: number },
): Promise<number> {
  const barcode = p.barcode?.trim() || null;
  if (barcode) {
    const clash = await db.getFirstAsync<{ id: number; name: string }>(
      'SELECT id, name FROM products WHERE barcode = ? AND id != ?',
      barcode,
      p.id ?? -1,
    );
    if (clash) throw new Error(`Barcode already used by "${clash.name}".`);
  }
  if (p.id) {
    await db.runAsync(
      'UPDATE products SET barcode=?, name=?, cost=?, price=?, qty=?, low_stock=? WHERE id=?',
      barcode,
      p.name.trim(),
      p.cost,
      p.price,
      p.qty,
      p.low_stock,
      p.id,
    );
    return p.id;
  }
  const r = await db.runAsync(
    'INSERT INTO products (barcode, name, cost, price, qty, low_stock, created_at) VALUES (?,?,?,?,?,?,?)',
    barcode,
    p.name.trim(),
    p.cost,
    p.price,
    p.qty,
    p.low_stock,
    now(),
  );
  return r.lastInsertRowId;
}

export function deleteProduct(db: SQLiteDatabase, id: number) {
  return db.runAsync('DELETE FROM products WHERE id = ?', id);
}

export type ProductMovement = {
  invoice_id: number;
  kind: InvoiceKind;
  date: string;
  qty: number;
  unit_price: number;
  party_name: string | null;
};

export function productHistory(db: SQLiteDatabase, productId: number) {
  return db.getAllAsync<ProductMovement>(
    `SELECT i.id AS invoice_id, i.kind, i.date, it.qty, it.unit_price, p.name AS party_name
     FROM invoice_items it JOIN invoices i ON i.id = it.invoice_id
     LEFT JOIN parties p ON p.id = i.party_id
     WHERE it.product_id = ? ORDER BY i.date DESC LIMIT 100`,
    productId,
  );
}

// ---------------------------------------------------------------------------
// Customers & suppliers
// ---------------------------------------------------------------------------

const PARTY_SELECT = `
  SELECT p.*,
    p.opening_balance
    + IFNULL((SELECT SUM(total - paid) FROM invoices WHERE party_id = p.id), 0)
    - IFNULL((SELECT SUM(amount) FROM payments WHERE party_id = p.id), 0) AS balance
  FROM parties p`;

export function listParties(db: SQLiteDatabase, type: PartyType, search = '') {
  return db.getAllAsync<Party>(
    `${PARTY_SELECT} WHERE p.type = ? AND (p.name LIKE ? OR p.phone LIKE ?) ORDER BY p.name COLLATE NOCASE`,
    type,
    `%${search.trim()}%`,
    `%${search.trim()}%`,
  );
}

export function getParty(db: SQLiteDatabase, id: number) {
  return db.getFirstAsync<Party>(`${PARTY_SELECT} WHERE p.id = ?`, id);
}

export async function saveParty(
  db: SQLiteDatabase,
  p: { id?: number; type: PartyType; name: string; phone: string; opening_balance: number },
): Promise<number> {
  if (p.id) {
    await db.runAsync(
      'UPDATE parties SET name=?, phone=?, opening_balance=? WHERE id=?',
      p.name.trim(),
      p.phone.trim(),
      p.opening_balance,
      p.id,
    );
    return p.id;
  }
  const r = await db.runAsync(
    'INSERT INTO parties (type, name, phone, opening_balance, created_at) VALUES (?,?,?,?,?)',
    p.type,
    p.name.trim(),
    p.phone.trim(),
    p.opening_balance,
    now(),
  );
  return r.lastInsertRowId;
}

export function deleteParty(db: SQLiteDatabase, id: number) {
  return db.runAsync('DELETE FROM parties WHERE id = ?', id);
}

export type LedgerEntry = {
  type: 'invoice' | 'payment';
  id: number;
  date: string;
  /** amount added to balance (invoice total) */
  charge: number;
  /** amount removed from balance (paid at sale or later payment) */
  credit: number;
  method: PayMethod;
  label: string;
};

export async function partyLedger(db: SQLiteDatabase, partyId: number): Promise<LedgerEntry[]> {
  const invoices = await db.getAllAsync<Invoice>('SELECT * FROM invoices WHERE party_id = ?', partyId);
  const payments = await db.getAllAsync<Payment>('SELECT * FROM payments WHERE party_id = ?', partyId);
  const entries: LedgerEntry[] = [
    ...invoices.map((i) => ({
      type: 'invoice' as const,
      id: i.id,
      date: i.date,
      charge: i.total,
      credit: i.paid,
      method: i.method,
      label: invoiceNumber(i),
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
  p: { party_id: number; direction: 'in' | 'out'; amount: number; method: PayMethod; note: string },
) {
  await db.runAsync(
    'INSERT INTO payments (party_id, direction, amount, method, date, note) VALUES (?,?,?,?,?,?)',
    p.party_id,
    p.direction,
    p.amount,
    p.method,
    now(),
    p.note,
  );
}

export function deletePayment(db: SQLiteDatabase, id: number) {
  return db.runAsync('DELETE FROM payments WHERE id = ?', id);
}

// ---------------------------------------------------------------------------
// Invoices (sales & purchases) — these move stock
// ---------------------------------------------------------------------------

export type LineInput = {
  product_id: number;
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
    party_id: number | null;
    lines: LineInput[];
    taxRate: number;
    paid: number;
    method: PayMethod;
    note?: string;
  },
): Promise<number> {
  const subtotal = inv.lines.reduce((s, l) => s + l.qty * l.unit_price, 0);
  const tax = inv.kind === 'sale' ? Math.round((subtotal * inv.taxRate) / 100) : 0;
  const total = subtotal + tax;
  let invoiceId = 0;

  await transaction(db, async (txn) => {
    const r = await txn.runAsync(
      'INSERT INTO invoices (kind, party_id, date, subtotal, tax, total, paid, method, note) VALUES (?,?,?,?,?,?,?,?,?)',
      inv.kind,
      inv.party_id,
      now(),
      subtotal,
      tax,
      total,
      inv.paid,
      inv.method,
      inv.note ?? '',
    );
    invoiceId = r.lastInsertRowId;
    for (const l of inv.lines) {
      await txn.runAsync(
        'INSERT INTO invoice_items (invoice_id, product_id, name, barcode, qty, unit_price, unit_cost) VALUES (?,?,?,?,?,?,?)',
        invoiceId,
        l.product_id,
        l.name,
        l.barcode,
        l.qty,
        l.unit_price,
        l.unit_cost,
      );
      if (inv.kind === 'sale') {
        await txn.runAsync('UPDATE products SET qty = qty - ? WHERE id = ?', l.qty, l.product_id);
      } else {
        await txn.runAsync('UPDATE products SET qty = qty + ?, cost = ? WHERE id = ?', l.qty, l.unit_price, l.product_id);
        if (l.new_sell_price && l.new_sell_price > 0) {
          await txn.runAsync('UPDATE products SET price = ? WHERE id = ?', l.new_sell_price, l.product_id);
        }
      }
    }
  });
  return invoiceId;
}

/** Deletes an invoice and puts the stock back the way it was. */
export async function voidInvoice(db: SQLiteDatabase, id: number) {
  await transaction(db, async (txn) => {
    const inv = await txn.getFirstAsync<Invoice>('SELECT * FROM invoices WHERE id = ?', id);
    if (!inv) return;
    const items = await txn.getAllAsync<InvoiceItem>('SELECT * FROM invoice_items WHERE invoice_id = ?', id);
    for (const it of items) {
      if (it.product_id == null) continue;
      const sign = inv.kind === 'sale' ? 1 : -1;
      await txn.runAsync('UPDATE products SET qty = qty + ? WHERE id = ?', sign * it.qty, it.product_id);
    }
    await txn.runAsync('DELETE FROM invoice_items WHERE invoice_id = ?', id);
    await txn.runAsync('DELETE FROM invoices WHERE id = ?', id);
  });
}

export async function getInvoice(db: SQLiteDatabase, id: number) {
  const inv = await db.getFirstAsync<Invoice>(
    `SELECT i.*, p.name AS party_name FROM invoices i LEFT JOIN parties p ON p.id = i.party_id WHERE i.id = ?`,
    id,
  );
  if (!inv) return null;
  const items = await db.getAllAsync<InvoiceItem>('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id', id);
  return { invoice: inv, items };
}

export function listInvoices(db: SQLiteDatabase, kind: InvoiceKind | 'all', search = '') {
  const q = `%${search.trim()}%`;
  return db.getAllAsync<Invoice>(
    `SELECT i.*, p.name AS party_name FROM invoices i LEFT JOIN parties p ON p.id = i.party_id
     WHERE (? = 'all' OR i.kind = ?) AND (IFNULL(p.name,'') LIKE ? OR CAST(i.id AS TEXT) LIKE ?)
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
    `SELECT IFNULL(SUM(total),0) AS total, COUNT(*) AS n FROM invoices WHERE kind='sale' AND date >= ?`,
    since,
  );
  const profit = await db.getFirstAsync<{ v: number }>(
    `SELECT IFNULL(SUM(it.qty * (it.unit_price - it.unit_cost)),0) AS v
     FROM invoice_items it JOIN invoices i ON i.id = it.invoice_id WHERE i.kind='sale' AND i.date >= ?`,
    since,
  );
  const cash = await db.getFirstAsync<{ cin: number; cout: number }>(
    `SELECT
       IFNULL((SELECT SUM(paid) FROM invoices WHERE kind='sale' AND method='cash' AND date >= ?),0)
       + IFNULL((SELECT SUM(amount) FROM payments WHERE direction='in' AND method='cash' AND date >= ?),0) AS cin,
       IFNULL((SELECT SUM(paid) FROM invoices WHERE kind='purchase' AND method='cash' AND date >= ?),0)
       + IFNULL((SELECT SUM(amount) FROM payments WHERE direction='out' AND method='cash' AND date >= ?),0) AS cout`,
    since,
    since,
    since,
    since,
  );
  const balances = await db.getAllAsync<{ type: PartyType; balance: number }>(
    `SELECT type, balance FROM (${PARTY_SELECT})`,
  );
  const stock = await db.getFirstAsync<{ v: number }>(
    'SELECT IFNULL(SUM(MAX(qty,0) * cost),0) AS v FROM products',
  );
  const lowStock = await db.getAllAsync<Product>(
    'SELECT * FROM products WHERE qty <= low_stock ORDER BY qty ASC, name LIMIT 20',
  );
  return {
    salesTotal: sales?.total ?? 0,
    salesCount: sales?.n ?? 0,
    profit: profit?.v ?? 0,
    cashIn: cash?.cin ?? 0,
    cashOut: cash?.cout ?? 0,
    receivable: balances.filter((b) => b.type === 'customer' && b.balance > 0).reduce((s, b) => s + b.balance, 0),
    payable: balances.filter((b) => b.type === 'supplier' && b.balance > 0).reduce((s, b) => s + b.balance, 0),
    stockValue: stock?.v ?? 0,
    lowStock,
  };
}

/** Balance a customer/supplier has right after a given invoice (for printing on the receipt). */
export async function partyBalance(db: SQLiteDatabase, partyId: number): Promise<number> {
  return (await getParty(db, partyId))?.balance ?? 0;
}
