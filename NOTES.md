# Notes: decisions, open questions, and what I'd do differently

Written for the technical lead. The trial asks for this note ("what you would do differently when building the real system, and anything in our rules that seems unclear or wrong"), so here it is for the whole prototype.

## One thing in the brief I'd change

**"A report on last month gives the same numbers in six months" needs month closing, not only immutable rows.** Storing every amount with its rate, and refusing edits, keeps the rows still. But a receipt recorded late, an expense entered next week or an exchanger payout dated last Friday can still land in last month and move its report. The prototype adds `close_period`: once the owner closes a month, anything dated into it is refused, and late items go into the open period with a note. The acceptance check proves both parts. I'd make closing part of the monthly routine, after the closing checks pass.

## Rules I read one way and would confirm

1. **Rates are whole pounds per dollar.** All the brief's examples are whole numbers, and they make SDG totals exact with no rounding (cents × rate). If a rate like 8,212.50 is ever needed, I'd store it in hundredths instead, and add one rounding rule for the SDG total.
2. **Discount boundaries.** I read exactly 3.00% as sand and exactly 5.00% as red, so both are allowed. The comparison uses integers only (`discount × 10000 ≤ value × 300`), so $9.9999 can't round down into sand.
3. **An approval covers one exact line**: the same draft, customer, product, quantity, price and discount. If the adviser changes the discount afterwards, the approval no longer applies. It is used once. The owner's own orders record the owner's approval automatically.
4. **Quote to order.** While the quote is valid, conversion keeps the quote's rate and prices. After that the adviser enters today's rate (at least the minimum). The dollar prices stay as quoted. Is that right, or should an expired quote reprice from today's catalogue?
5. **The daily limit is a warning, the 3,000,000 cap is a rule.** A transfer over an account's daily limit has already happened, so it is recorded and flagged, not refused. A single receipt above 3,000,000 is refused as a probable typo.
6. **Duplicates.** Same code and same amount is refused. Same code and a different amount is kept aside, flagged for the owner, and the original is untouched. The same image under another code is refused (SHA-256 of the file). Could two banks ever issue the same code? If so, the key should be bank plus code.
7. **Currency result.** It is realised when the exchanger pays out, measured against the order's own rate, and settled first-in first-out per account. Conversions on the UAE account give their own result at route level. Your August example has a net after currency of 30.3% against a gross of 25.7%. Is "net before currency" the gross minus expenses and refunds, or also minus the 20% uplift, which is a safety margin rather than a real cost?
8. **Euros.** Every amount converts at its own day's rate: sales at the order date, cost at the shipment date, the currency result at the payout date. That follows "the rate of the day it happened". It also means the euro gross profit is not the dollar gross times any one rate. I'd confirm that's what you expect to see.
9. **Which costs get the 20% uplift?** I applied it to every indirect cost (freight, insurance, customs, clearance, port, transport). On S-2026-014 that turns the $270 inverter into $303.58, as in your example.
10. **A receipt pays orders of one dealer.** Could a relative's transfer pay for two different dealers? The rule is easy to relax.

## What I'd do differently in the real system

- **Sign-in:** Supabase Auth with email and password and password reset, with the tenant and role in custom JWT claims so the policies don't look up the membership on every row. The demo's "pick a person" is only a stand-in.
- **Offline:** the outbox (idempotent ids, queued on the phone, retried) moves to IndexedDB with a service worker, so a queued receipt survives the app being closed. Proof photos upload in the background, resumable.
- **Tests:** keep the TypeScript acceptance checks, which read like your acceptance tests. Add pgTAP for policy-by-policy coverage in the database, and a small Playwright suite on a phone viewport for the order screen.
- **Screenshots:** automatic reading, since you asked for my view. It is worth it after step 3, as a suggestion rather than an entry. A vision model reads the code, amount, date and sender from the Arabic screenshot and pre-fills the form; the adviser confirms; the duplicate checks run as they do now. Your 211 labelled screenshots are the test set. I would never let it save on its own: a misread amount on a transfer is exactly the kind of error the whole system exists to prevent.
- **Import before go-live:** a set of import functions with a dry run and a reconciliation report (opening balances per account, open orders and their paid amounts, stock per lot with landed cost). Go-live starts from a closed opening period, so the imported history can't move.
- **Dealers (step 12):** one person may one day need two environments. The membership table already has a tenant per row; letting a user hold several is a small change.

## Things the demo does that production wouldn't

- The database runs in the browser (PGlite) with the same migrations, so the demo needs no server and the checks can run live. `supabase/local/*` holds the auth stand-in and a replay clock used only to seed three months of history through the real functions.
- The screenshots of seeded receipts are drawn from the receipt's data. Uploaded ones are kept in the browser, where production would use Supabase Storage (policies in `supabase/production/storage.sql`).
