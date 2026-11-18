import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type { Invoice, InvoiceItem, LedgerEntry, Party, Settings } from './db';
import { invoiceNumber } from './db';
import { formatDateTime, money } from './money';

export type DocStyle = 'invoice' | 'receipt';

const esc = (s: string | null | undefined) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const methodLabel = { cash: 'Cash', card: 'Card', other: 'Other' } as const;

export function buildDocumentHtml(
  style: DocStyle,
  s: Settings,
  inv: Invoice,
  items: InvoiceItem[],
  accountBalance: number | null,
): string {
  const isSale = inv.kind === 'sale';
  const due = inv.total - inv.paid;
  const title = isSale ? (style === 'receipt' ? 'RECEIPT' : 'INVOICE') : 'PURCHASE RECORD';
  const partyLabel = isSale ? 'Bill to' : 'Supplier';
  const narrow = style === 'receipt';

  const rows = items
    .map(
      (it) => `<tr>
        <td>${esc(it.name)}${!narrow && it.barcode ? `<div class="muted">${esc(it.barcode)}</div>` : ''}</td>
        <td class="r">${it.qty}</td>
        <td class="r">${money(it.unit_price)}</td>
        <td class="r">${money(it.qty * it.unit_price)}</td>
      </tr>`,
    )
    .join('');

  const balanceRows = `
    <tr><td>Subtotal</td><td class="r">${money(inv.subtotal)}</td></tr>
    ${inv.tax ? `<tr><td>Tax</td><td class="r">${money(inv.tax)}</td></tr>` : ''}
    <tr class="strong"><td>Total</td><td class="r">${money(inv.total)}</td></tr>
    <tr><td>Paid (${methodLabel[inv.method]})</td><td class="r">${money(inv.paid)}</td></tr>
    ${
      due > 0
        ? `<tr class="strong"><td>Balance due</td><td class="r">${money(due)}</td></tr>`
        : due < 0
          ? `<tr><td>${inv.party_id ? 'Applied to account' : 'Change'}</td><td class="r">${money(-due)}</td></tr>`
          : ''
    }
    ${
      accountBalance != null && inv.party_id
        ? `<tr class="acct"><td>Account balance${isSale ? ' owed' : ''}</td><td class="r">${money(accountBalance)}</td></tr>`
        : ''
    }`;

  return `<!doctype html><html><head><meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #111; margin: 0; padding: ${narrow ? '12px' : '40px'}; font-size: ${narrow ? '12px' : '13px'}; }
    .wrap { max-width: ${narrow ? '300px' : '720px'}; margin: 0 auto; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; ${narrow ? 'flex-direction: column; align-items: center; text-align: center;' : ''} }
    h1 { margin: 0; font-size: ${narrow ? '18px' : '24px'}; }
    h2 { margin: ${narrow ? '8px 0 0' : '0'}; font-size: ${narrow ? '14px' : '20px'}; letter-spacing: 2px; color: #0f766e; }
    .muted { color: #666; font-size: 0.9em; }
    .meta { margin: 16px 0; display: flex; justify-content: space-between; ${narrow ? 'flex-direction: column; gap: 4px;' : ''} }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; border-bottom: 2px solid #111; padding: 6px 4px; font-size: 0.85em; text-transform: uppercase; }
    td { padding: 6px 4px; border-bottom: 1px solid #e5e5e5; vertical-align: top; }
    .r { text-align: right; white-space: nowrap; }
    .totals { margin-top: 12px; margin-left: auto; width: ${narrow ? '100%' : '50%'}; }
    .totals td { border: none; padding: 3px 4px; }
    .strong td { font-weight: 700; font-size: 1.1em; border-top: 1px solid #111; }
    .acct td { background: #f0fdfa; font-weight: 600; }
    .footer { margin-top: 24px; text-align: center; color: #555; }
  </style></head><body><div class="wrap">
    <div class="head">
      <div>
        <h1>${esc(s.businessName)}</h1>
        ${s.address ? `<div class="muted">${esc(s.address).replace(/\n/g, '<br/>')}</div>` : ''}
        ${s.phone ? `<div class="muted">${esc(s.phone)}</div>` : ''}
        ${s.email ? `<div class="muted">${esc(s.email)}</div>` : ''}
      </div>
      <h2>${title}</h2>
    </div>
    <div class="meta">
      <div><strong>${partyLabel}:</strong> ${esc(inv.party_name ?? (isSale ? 'Walk-in customer' : '—'))}</div>
      <div><strong>No:</strong> ${invoiceNumber(inv)} &nbsp; <strong>Date:</strong> ${formatDateTime(inv.date)}</div>
    </div>
    <table>
      <thead><tr><th>Item</th><th class="r">Qty</th><th class="r">${isSale ? 'Price' : 'Cost'}</th><th class="r">Amount</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <table class="totals"><tbody>${balanceRows}</tbody></table>
    ${inv.note ? `<p class="muted">Note: ${esc(inv.note)}</p>` : ''}
    ${isSale && s.footer ? `<div class="footer">${esc(s.footer)}</div>` : ''}
  </div></body></html>`;
}

export async function shareDocument(html: string, style: DocStyle) {
  const { uri } = await Print.printToFileAsync({
    html,
    width: style === 'receipt' ? 300 : 612,
    height: style === 'receipt' ? 900 : 792,
  });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Send invoice', UTI: 'com.adobe.pdf' });
  } else {
    await Print.printAsync({ uri });
  }
}

export async function printDocument(html: string) {
  await Print.printAsync({ html });
}

export function buildStatementHtml(s: Settings, party: Party, ledger: LedgerEntry[]): string {
  const isCustomer = party.type === 'customer';
  // Oldest first with a running balance.
  let running = party.opening_balance;
  const rows = [...ledger]
    .reverse()
    .map((e) => {
      running += e.charge - e.credit;
      return `<tr><td>${new Date(e.date).toLocaleDateString('en-US')}</td><td>${esc(e.label)}</td>
        <td class="r">${e.charge ? money(e.charge) : ''}</td><td class="r">${e.credit ? money(e.credit) : ''}</td>
        <td class="r">${money(running)}</td></tr>`;
    })
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"/><style>
    body { font-family: -apple-system, Helvetica, Arial, sans-serif; padding: 40px; font-size: 13px; color: #111; }
    h1 { margin: 0; } h2 { color: #0f766e; letter-spacing: 2px; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th { text-align: left; border-bottom: 2px solid #111; padding: 6px 4px; font-size: 11px; text-transform: uppercase; }
    td { padding: 6px 4px; border-bottom: 1px solid #e5e5e5; }
    .r { text-align: right; } .muted { color: #666; }
    .bal { margin-top: 20px; font-size: 18px; font-weight: 700; text-align: right; }
  </style></head><body>
    <h1>${esc(s.businessName)}</h1>
    ${s.phone ? `<div class="muted">${esc(s.phone)}</div>` : ''}
    <h2>ACCOUNT STATEMENT</h2>
    <div><strong>${isCustomer ? 'Customer' : 'Supplier'}:</strong> ${esc(party.name)} &nbsp; <strong>Date:</strong> ${new Date().toLocaleDateString('en-US')}</div>
    <table><thead><tr><th>Date</th><th>Description</th><th class="r">Charges</th><th class="r">Payments</th><th class="r">Balance</th></tr></thead>
    <tbody>
      ${party.opening_balance ? `<tr><td></td><td>Starting balance</td><td></td><td></td><td class="r">${money(party.opening_balance)}</td></tr>` : ''}
      ${rows}
    </tbody></table>
    <div class="bal">${isCustomer ? 'Balance due' : 'Balance owed'}: ${money(party.balance)}</div>
  </body></html>`;
}
