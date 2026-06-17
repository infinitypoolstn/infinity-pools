# Infinity Pools — Build Manager

A blue-and-white web app for running your in-ground pool business end to end:
prospects → contract → phased build tracking → payments → completion.

## Starting the app

```
cd infinity-pools
npm start
```

Then open **http://localhost:4525** in your browser.

> The Monday 7:00 AM Pebble Tec check and the daily 7:00 AM due-date emails run
> while the app is running. To have Windows start it automatically at login:
> Task Scheduler → Create Basic Task → "When I log on" → Start a program →
> Program: `node`, Arguments: `server.js`, Start in: this folder.

## One-time setup

1. **Employees** — add your team (their emails receive every automatic alert).
2. **Settings → Email (Gmail)** — at https://myaccount.google.com/apppasswords
   create an App Password for "Mail" (requires 2-Step Verification on the
   admin@infinitypoolstn.com Google account), paste the 16-character code, and
   click *Send test email*. Until this is done, every email the app tries to
   send is logged under **Alerts → Email Log** instead of being sent.
3. **Settings → QuickBooks** *(optional)* — see below.
4. **Settings → Disclosures** — these are universal and flow into every
   contract PDF automatically. Edit or add sections any time.

## Daily workflow

1. **＋ Add New Prospect** (dashboard) → name, address, email, phone → Save
   opens the Client page.
2. **Pool Specs** tab — shape, size, hot tub, sun shelf, spillover,
   ledge/seating (with style dropdown), water feature, jets, LED lights,
   equipment pad, and unlimited custom add-on fields.
3. **Finance** tab — Excavation / Pool Forming / Shotcrete / Tile / Materials /
   Labor plus any added charges; the phase-draw table updates automatically
   (10/0/15/25/25/15/10%).
4. **Files** tab — multi-upload plans, renderings, permits, invoices; download
   or email them to the client, an employee, or any address. Tick
   **⭐ Contract Cover Photo** on a rendering to put it on the contract's front
   page.
5. **Design** tab — click the swatches the client chose (grouped by rate-sheet
   tier, prices never shown).
6. **Contract & Phases** tab — *Preview Contract PDF*, *Email Contract to
   Client*, then send the PDF for signature through Adobe Acrobat Sign. When
   it's signed (digitally or on paper, with optional cash/check deposit), click
   **✓ Contract Signed**: specs and pricing lock, the Design phase starts, the
   team is emailed, and the 10% design draw request goes to the client.
7. As work progresses, **✓ Complete Phase**: the next phase activates with a
   due date, all employees get a Gmail + dashboard alert, and the client
   automatically receives the next draw's payment request.
8. **Change Orders** tab (after signing) — log each change with a value;
   totals appear at the top, on the dashboard, and on the client portal.
9. **Costs (Internal)** tab — record actual build costs for profit/margin
   tracking. This data is never included in anything client-facing.
10. **Client Portal** tab — copy the private link for the client. It shows the
    Domino's-style build tracker with the animated pool, the current phase's
    deposit + QuickBooks pay button, their chosen finishes, and any to-do
    items you flag for them.

## QuickBooks payments

Two ways to use it:

- **Manual (works today, nothing to set up):** create the invoice in
  QuickBooks as usual, copy its payment link, and paste it into the *Send
  payment request* dialog on any phase. The emailed request and the client
  portal both use that link.
- **Connected (automated):** create an app at https://developer.intuit.com
  with the *Accounting* scope, run through the OAuth flow once to obtain a
  refresh token, and paste Realm ID / Client ID / Client Secret / Refresh
  Token into Settings. Then marking a contract signed automatically creates
  the full-amount invoice in QuickBooks, and phase emails use its Pay Now
  link; each phase payment applies against that invoice.

Fee notes shown to clients (ACH ~1%, card ~3.5%) are editable in Settings.

## Weekly Pebble Tec accuracy check

Every Monday 7:00 AM CST the app compares the Design Library against
https://pebbletec.com/products/all-finishes/ and emails
admin@infinitypoolstn.com if finishes were added or removed (and posts a
dashboard alert). You can run it on demand from Design Library →
*Check pebbletec.com now*. Swatch photos are cached locally in
`public/swatches/` so the design pages and contract PDFs work offline.

## Where data lives

- `data/data.json` — all records (clients, contracts, tasks, settings…). Back
  this folder up.
- `uploads/` — uploaded documents, organized per client.
- `data/contracts/` — generated contract PDFs.

## Security notes

- The admin app has no login — run it on your office machine/network only.
  The client portal is safe to share: each client gets an unguessable private
  link and only ever sees their own phases, payments, and finishes — never
  costs or internal pricing.
