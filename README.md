# Qirsh: orders, money and stock for a solar distributor

A working prototype of the all-in-one platform in the brief: one foundation, three modules (Finance, Stock, Communication) and a dashboard, for a distributor that prices in US dollars, is paid in Sudanese pounds and reports in euros. It covers the trial task completely, and the hard parts of steps 1 to 9.

**Live demo:** [DEMO LINK] · **Acceptance checks, live:** [DEMO LINK]/checks

The business, people, bank codes and amounts are invented. Every phone number is 0123456788.

## Try the trial task

1. Sign in as **Amira Hassan** (sales adviser). You land on **New order**.
2. Tap **Fill in the worked example**. You get Ahmed Trading and four SPF 6000 ES Plus at $40 off, which is sand at 1.94%. Then two Hope 5.0L-B1 at $70 off, which is red at 4.32%. Then one Hope 16.0LM-A1 at $150 off, which is blocked at 7.25%. The rate is 8,200.
3. **Save order** is disabled. The summary says that without line 3 the order is $3,570, which is 29,274,000 SDG. Remove line 3 and it saves at exactly that.
4. Type **7900** as the rate and leave the field. The screen refuses it and puts back 8,000. The database refuses it as well if called directly.
5. On line 3, tap **Ask the owner to approve**. Then use **Menu → Switch person → Hamid Osman → Approvals → Approve**.
6. Switch back to Amira. The draft is still there, line 3 shows "Approved by Hamid Osman", and the order saves at **$5,490, which is 45,018,000 SDG**.
7. As Hamid, open **Settings** and set the minimum rate to **9,000**. Reopen the order: it still shows 8,200 and 45,018,000 SDG.

The same walk-through is part of 28 automated checks, most of which try to break the rules the way someone with direct database access would. They run in CI and live at `/checks`.

## What's built

| Step | What you can do in the demo |
|---|---|
| 1. Platform | Personal logins with 4 roles, and every permission enforced in Postgres. Environments (tenants) with their own branding and settings, and a dealer environment sealed from the distributor. Configurable account kinds. Account holders with every spelling of their name ("Mogtaba", "Mujtaba", "Motgaba"). |
| 2. Orders | Fixed dollar prices that only the owner can override. Discounts per line (sand, red, blocked) with an owner approval bound to that exact line. The minimum rate. Orders that never change. Payment instructions across the accounts with room today, sent on WhatsApp. |
| 3. Receipts | One row per transaction code, with a photo. A duplicate is refused; the same code with another amount is flagged; the same screenshot twice is refused. One receipt can pay several orders. Status goes received → forwarded → confirmed. |
| 4. Accounts | Exchanger, own, pass-through and UAE accounts with live balances from a ledger where every movement has an origin and a destination. Today's intake against the limit, and what each exchanger still holds. Payouts in euros or dirhams, transfers, cash taken by staff, expenses and refunds. Statements checked against the ledger. |
| 5. Release | The warehouse sees a pick list with no amounts and can only release fully paid orders. Stock is taken oldest lot first. |
| 6. Purchasing | Invoices in USD or EUR (with the rate paid and the bank's commission). Costs in USD, EUR, AED or SDG. A 20% uplift spread pro rata to purchase value, so on S-2026-014 the $270 inverter lands at **$303.58**. Goods in transit, and stock movements. |
| 7. Margin | Gross profit, net before currency, currency result and net after currency. Per month, shipment, product, customer, adviser, order and currency route, in USD or EUR, as amounts or margins. Twelve closing checks, and month closing. |
| 8. Quotes | Branded quote and price-list PDFs, shared on WhatsApp. One click turns a quote into an order, keeping the quoted rate while the quote is valid. |
| 9. CRM | Segments A+ to D, pipeline, source, labels, notes, full history, and revenue per active dealer. |

Built for later from day one:
- **Step 10:** contacts with opt-in, and a messages table ready for the WhatsApp Business API.
- **Step 11:** every string lives in `messages/en.json`, the layout uses start/end only, and number and date formats follow the locale. There is a partial Arabic preview in the menu.
- **Step 12:** multi-tenant with row level security everywhere; the dealer environment is live in the demo.

## How money is stored

- Every amount is an integer in the smallest unit of its currency (`bigint`, column names end in `_minor`). Rates are integers too: whole pounds per dollar, and other rates in parts per million.
- An order stores its own rate and its totals in USD, SDG and EUR at the moment it is saved. A trigger refuses any later change to those columns, for every role including the owner.
- A receipt's slice of an order stores its dollar and euro value **at that order's rate**. The split is cumulative, so the slices of a paid order add up exactly to its totals.
- When an exchanger pays out, the pounds are settled first-in first-out against those slices. What arrived (at the payout day's rate, stored) minus what the order said they were worth is the **currency result**. It is stored per slice, with its order, customer, adviser and route.
- Revenue and landed cost are fixed per lot when goods leave the warehouse (`restricted.sale_facts`).
- Reports only add up these stored integers. No rate is looked up while reporting.
- **Closing a month** stops anything new from being dated into it. Without that, a late receipt would still move last month's report.

## Permissions

| | Owner | Marketing | Sales adviser | Warehouse |
|---|---|---|---|---|
| Prices | set | read | read | no |
| Customers | all | all, edit | her own, edit | names on the pick list only |
| Orders | all | read | her own customers', create | pick list, no amounts |
| Receipts and accounts | all | no | her customers'; accounts to pay into | no |
| Costs and margins | all | no | no | no |
| Stock and shipments | all | read | read | read, receive, release |

- Reads go through row level security.
- Writes go only through `security definer` functions, and each one checks the caller's role. Signed-in users have `SELECT` and nothing else on tables.
- Cost prices, landed cost and margins live in the `restricted` schema. No API role has any privilege on it, and the API doesn't expose it.

## Repository

```
apps/web            Next.js 16 (App Router, TypeScript, Tailwind v4): the screens
libs/money          the money rules in TypeScript, the same ones the database applies
libs/db             database client (PGlite for the demo and tests, Supabase adapter for production),
                    demo data replayed through the real functions, and the acceptance checks
supabase/migrations the schema, rules, row level security and reports (the source of truth)
supabase/production storage buckets and policies for the hosted project
supabase/local      demo-only shims (auth stand-in, replay clock); never pushed
.github/workflows   CI: typecheck, tests and build for affected projects; migrations on main
```

It is an Nx workspace; each project's targets come from its `package.json` scripts.

```bash
npm install
npm run dev          # http://localhost:4331
npm test             # money rules, and every migration and check in Postgres (PGlite)
npm run ci           # typecheck, test and build all projects
```

The build uses webpack (`next build --webpack`). Turbopack currently breaks the Emscripten loader that PGlite, the in-browser Postgres, uses to start.

### From demo to production

The screens only call `rpc(fn, args)`, which has the same shape as `supabase.rpc`. To run against a hosted project:

1. `supabase db push` (the migrations, then `supabase/production/storage.sql`).
2. Swap the demo sign-in for Supabase Auth (email and password, with password reset).
3. Use `supabaseApi(createClient(...))` from `libs/db` instead of the in-browser database.

Row level security and every rule stay where they are. The CI workflow already pushes migrations from `main` once `SUPABASE_PROJECT_ID` is set.

Decisions, questions about the rules, and what the real system would do differently are in [NOTES.md](NOTES.md).
