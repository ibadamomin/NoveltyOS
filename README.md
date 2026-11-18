# StockBook — inventory, sales & invoices for small sellers

A simple phone app for iPhone and Android for small sellers who work from a garage, a market stall or the back of a car.
Scan a barcode or QR code when stock comes in, scan it again when you sell it, and the app keeps your stock,
cash, customer balances and supplier balances in sync for you.

Built with **Expo (React Native)**, so one codebase runs on both iOS and Android.
All data is stored **on the phone** (SQLite) and works without internet.

## What it does

| Area | Features |
|---|---|
| **Receive Stock** (purchases) | Scan each item, then enter the quantity, your cost and the selling price. New barcodes become new products automatically. Pick a supplier and enter what you paid. Anything unpaid goes on that supplier's account (accounts payable). |
| **Sell** | Scan items one after another, with the camera staying open for fast checkout. Change quantities or prices, pick a customer or "walk-in", and take Cash, Card or Other. The app shows the change to give, or how much goes on the customer's account (accounts receivable). |
| **Invoices & receipts** | Every sale gets an invoice number. Send it as a full-page **invoice PDF** or a narrow **receipt PDF** by text, email or WhatsApp, or print it. Each one shows the amount paid, the balance due and the customer's total account balance. |
| **Accounts** | Customers and suppliers with live balances. Record cash or card payments in a couple of taps. Full history for each one. Share an **account statement** PDF with a running balance. You can enter a starting balance for debts from before the app. |
| **Inventory** | Search by name or barcode, or scan to find a product. Stock levels show in colour, with low-stock alerts. Each product has a history of every purchase and sale. You can still add items that have no barcode. |
| **Home dashboard** | Sales, profit, cash in, cash out and **net cash for the period** (today, 7 days or 30 days), so you can check the cash box. Also shows total receivable, total payable, stock value at cost and items running low. |
| **Mistakes** | Void a sale or purchase and the stock and balances are reversed automatically. You can also delete a payment. |
| **Settings** | Business name, address, phone, email, sales-tax %, currency symbol and receipt footer. These make the app white-label for each business that uses it. |

### How balancing works
Money is stored as whole cents, so totals never drift. Balances are **never typed in by hand**. They are always
calculated from the records:

```
customer balance = starting balance + Σ(sale totals − paid at sale) − Σ(payments received)
supplier balance = starting balance + Σ(purchase totals − paid at purchase) − Σ(payments made)
cash in  = cash paid at sales + cash payments received
cash out = cash paid for purchases + cash payments to suppliers
```

## Try it on your phone (about 5 minutes)

1. Install **Expo Go** from the App Store or Google Play.
2. On a computer with Node.js 20 or later:
   ```bash
   cd stockbook
   npm install
   npx expo start
   ```
3. Scan the QR code shown in the terminal with your phone's camera (iPhone) or with the Expo Go app (Android).

## Publish to the App Store and Google Play

Builds happen in the cloud with EAS, so you don't need a Mac or Android Studio. You do need an
[Apple Developer account](https://developer.apple.com/programs/) ($99/yr) and a
[Google Play Console account](https://play.google.com/console) ($25 one-time).

```bash
npx eas-cli@latest login
npx eas-cli@latest build:configure
npx eas-cli@latest build --platform all
npx eas-cli@latest submit --platform ios
npx eas-cli@latest submit --platform android
```

Before you publish, change `ios.bundleIdentifier` and `android.package` in `app.json` (currently `com.stockbook.app`)
to an ID you own, and replace the icons in `assets/`.

## Project layout

```
src/app/                 screens (Expo Router — each file is a screen)
  (tabs)/index.tsx       Home dashboard
  (tabs)/sell.tsx        Sell / cart / checkout
  (tabs)/inventory.tsx   Product list
  (tabs)/people.tsx      Customers & suppliers
  (tabs)/history.tsx     Sales & purchase records
  receive.tsx            Receive stock (purchases)
  product/[id].tsx       Add / edit product + movement history
  party/[id].tsx         Customer/supplier account, payments, statement
  invoice/[id].tsx       Invoice view, share/print, void
  settings.tsx           Business settings
src/lib/db.ts            Database schema and all bookkeeping logic
src/lib/documents.ts     Invoice / receipt / statement PDFs
src/components/          Scanner, pickers, shared UI
```

Checks: `npx tsc --noEmit` (typecheck) and `npx expo lint`.

## Good next steps before selling to other businesses
- **Backup / restore and multi-device sync.** Today the data lives only on one phone, so losing the phone means losing the
  records. The usual next step is a cloud backend (for example Supabase) with a login per business. That also allows
  subscriptions, more than one phone per business and a web dashboard.
- CSV export for an accountant.
- Optional PIN lock, and Bluetooth receipt printers.
