# Google Play: store listing & Play Console answers

Copy these into **Play Console**. Items marked `[ ]` need your input.

---

## 1. Main store listing (Grow → Store presence → Main store listing)

**App name** (max 30): `noveltyOS: Inventory & Sales`

**Short description** (max 80):
`Scan barcodes, track stock, sell, and send invoices. Made for small sellers.`

**Full description** (max 4000):

```
noveltyOS is the simple way to run a small shop from your phone — whether you sell from a garage, a market stall, a pop-up or the back of your car.

Scan a product's barcode when stock arrives, scan it again when you sell it, and noveltyOS keeps your stock, cash and customer balances up to date automatically. No more balancing notebooks by hand.

RECEIVE STOCK IN SECONDS
• Scan barcodes or QR codes with your camera
• Enter how many you bought, what you paid and your selling price
• New barcodes become new products automatically
• Track what you owe each supplier

FAST CHECKOUT
• Keep scanning — the camera stays open for quick sales
• Take cash, card or other payments
• Instantly see the change to give back
• Put part or all of a sale on a customer's account

INVOICES & RECEIPTS
• Every sale gets an invoice number
• Send a professional invoice or receipt as a PDF by text, email or WhatsApp
• Print receipts
• Each document shows the amount paid, the balance due and the customer's account balance

CUSTOMER & SUPPLIER BALANCES
• Always know who owes you and who you owe
• Record cash payments in one tap
• Share account statements with a running balance
• Add starting balances from your old paper books

KNOW YOUR NUMBERS
• Today's sales, profit, cash in and cash out
• "Net cash" tells you exactly how much your cash box should have changed
• Low-stock alerts and stock value at cost
• Full history for every product, customer and supplier

WORKS OFFLINE. BACKS UP TO THE CLOUD.
• Everything works with no signal — your data lives on your phone
• Optional cloud backup keeps your records safe if you lose your phone
• Add more phones or employees with an invite code; changes sync automatically

MISTAKES HAPPEN
• Void a sale or purchase and your stock and balances fix themselves

Private by design: no ads, no tracking, and we never sell your data.
```

**App icon:** `docs/play-store/graphics/icon-512.png`
**Feature graphic:** `docs/play-store/graphics/feature-graphic.png` (1024×500)
**Phone screenshots:** `docs/play-store/graphics/screenshot-*.png` (upload in numbered order)

**App category:** Business
**Tags:** Inventory, Point of sale, Invoicing, Small business
**Contact email (shown publicly):** `[CONTACT EMAIL]`
**Website (optional):** `https://github.com/ibadamomin/NoveltyOS`
**Privacy policy URL:** see section 7

---

## 2. App access (Policy → App content → App access)
Choose **"All or some functionality is restricted"** and add instructions:

```
All inventory, sales, invoicing and account-balance features work without signing in.
Only "Cloud Backup & Sync" (Home → cloud icon) needs an account. Reviewers can sign in with:
Email: [TEST ACCOUNT EMAIL]
Password: [TEST ACCOUNT PASSWORD]
```
`[ ]` Create a test account in your production Supabase project and put its details here.

## 3. Ads
**Does your app contain ads?** No.

## 4. Content rating (questionnaire)
- Category: **All other app types** (utility / productivity / business)
- Violence, sexuality, language, controlled substances, gambling: **No** to all
- Does the app allow users to interact or exchange content with other users? **No.** Records are shared only between
  members of the same business, with no messaging or public content.
- Does the app share the user's current location with other users? **No**
- Does the app allow users to purchase digital goods? **No**

Expected rating: **Everyone / PEGI 3**.

## 5. Target audience
**Age groups:** 18 and over. It's a business tool. Not designed for children.

## 6. Data safety (Policy → App content → Data safety)
**Does your app collect or share any of the required user data types?** Yes
**Is all of the user data collected by your app encrypted in transit?** Yes
**Do you provide a way for users to request that their data is deleted?** Yes
**Account deletion URL:** see section 7

| Data type | Collected | Shared | Optional? | Purposes |
|---|---|---|---|---|
| Personal info → **Email address** | Yes | No | Optional (only for Cloud Backup) | Account management, App functionality |
| Personal info → **User IDs** | Yes | No | Optional | Account management, App functionality |
| Personal info → **Name** (customers/suppliers the user enters) | Yes | No | Optional | App functionality |
| Personal info → **Phone number** (customers/suppliers the user enters) | Yes | No | Optional | App functionality |
| Financial info → **Other financial info** (sales, purchases, balances) | Yes | No | Optional | App functionality |

Do **not** declare: photos/videos (camera frames are processed on the device and never stored or sent), location,
contacts, app activity, web browsing, device IDs, crash logs or diagnostics. The app has no analytics or advertising SDKs.

*Why "collected" and "optional":* data counts as collected only when it leaves the phone. That happens only when the
user turns on Cloud Backup & Sync. Supabase processes the data on your behalf as a service provider, which Google
doesn't count as "sharing".

## 7. URLs
Google needs **public web URLs** for the privacy policy and account deletion. While the GitHub repo is **public**, you can use:
- Privacy policy: `https://github.com/ibadamomin/NoveltyOS/blob/main/docs/privacy-policy.md`
- Account deletion: `https://github.com/ibadamomin/NoveltyOS/blob/main/docs/delete-account.md`

⚠️ If you make the repo **private**, these links stop working. Put the two pages on a public site first, for example
GitHub Pages from a separate public repo, Google Sites, or your business website.

## 8. Other declarations (Policy → App content)
- **Financial features:** "My app doesn't provide any financial features". It records the user's own sales and
  payments but doesn't move money, lend, or process payments.
- **Government app:** No.  **News app:** No.  **Health:** No.
- **Advertising ID:** the app doesn't use the advertising ID.

---

## 9. Release checklist

1. `[ ]` Fill in the `[PLACEHOLDERS]` in `docs/privacy-policy.md` and `docs/delete-account.md`, then commit.
2. `[ ]` Set up the production Supabase project (README → "Turn on the cloud"), including **both** migrations in `supabase/migrations/`.
3. `[ ]` Add `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_KEY` as EAS environment variables for the
   **production** and **preview** environments (expo.dev → project → Environment variables).
4. `[ ]` Build: `npx eas-cli@latest build --platform android --profile production` (EAS creates and stores your upload key).
5. `[ ]` In Play Console, **create the app**, then upload the `.aab` **manually** to a testing track. Google requires the
   first upload to be done by hand. Later builds can use `npx eas-cli@latest submit --platform android`.
6. `[ ]` **Closed testing:** new personal developer accounts must run a closed test with a minimum number of testers
   opted in for a continuous period before production access. When this was written it was 12 testers for 14 days;
   Play Console shows the current numbers under *Test and release → Production*.
7. `[ ]` Apply for production access, then release.

⚠️ **The package name `com.noveltyos.app` is permanent once the first build is uploaded.** Change it in `app.json` now
if you want something else (for example `com.yourbusiness.noveltyos`).
