// All money is stored as integer cents so totals and balances never drift.

let currencySymbol = '$';

export function setCurrencySymbol(symbol: string) {
  currencySymbol = symbol || '$';
}

export function money(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100).toLocaleString('en-US');
  const frac = String(abs % 100).padStart(2, '0');
  return `${negative ? '-' : ''}${currencySymbol}${whole}.${frac}`;
}

/** Parse user text like "12", "12.5", "$1,234.56" into cents. Returns NaN if invalid. */
export function parseMoney(text: string): number {
  const cleaned = text.replace(/[^0-9.]/g, '');
  if (cleaned === '' || cleaned === '.') return NaN;
  const value = Number(cleaned);
  if (!isFinite(value)) return NaN;
  return Math.round(value * 100);
}

/** Cents -> plain editable text, e.g. 1250 -> "12.50" */
export function centsToInput(cents: number): string {
  if (!cents) return '';
  return (cents / 100).toFixed(2);
}

export function parseQty(text: string): number {
  const n = parseInt(text.replace(/[^0-9]/g, ''), 10);
  return isNaN(n) ? 0 : n;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${formatDate(iso)} ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}
