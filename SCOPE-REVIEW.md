# Scope and risk review: the brief, the Qirsh code and the milestone plan

Written 2026-10-01, before the ten-day handover to the user's friend. It is confidential and stays outside the
repository.

- **Sources:**
  - the final brief (`client-files/Shamsy_Project_Brief_final.txt`, all 17 sections);
  - the terms as drafted in `chatting.md` section 2;
  - the held milestone plan in `chatting.md` section 7;
  - the Qirsh code as it stands (`qirsh/`, commit 1e456e6).
- **What the hour figures are.** They are estimates made from reading the code, not measurements. Read them as
  ranges.
- **The milestone plan has not been sent.** That makes this review the last point where its split can change at no
  cost. Any change to the split is the user's decision.

## Summary: the six things that matter

1. **The margin acceptance test does not add up as written.** This puts milestone 7's payment (US$450) at risk.
   - Section 13 says the August 2026 shipment gives revenue $85,208, gross profit $21,918 (25.7%), a currency
     result of $4,135, and net profit after currency of $27,604 at 30.3%.
   - But $27,604 is 32.4% of $85,208, not 30.3%. Gross plus the currency result is $26,053, not $27,604, which
     leaves $1,551 unexplained. And 30.3% of the revenue would be $25,818.
   - The cost factor has a smaller version of the same problem. From the brief's own inputs, $59,983 at 1.1674
     plus €211 commission gives 0.860122, not 0.860234. The brief notes the €6 gap itself.
   - Milestones are paid when their tests pass on the live system, so the formula has to be agreed in writing
     from the real August files before milestone 7 starts. It may also change the data model, for example if
     the 20% uplift has to be reported as its own line. So it should be settled early, not at step 7. (See §1.)
2. **Several requirements in the brief belong to no milestone.** Each can surface at go-live, the one payment
   that is held for two weeks. Each should be tied to a milestone now. (See §3.) They are:
   - section 14: two-factor sign-in for the owner, and a full export of all data at any time;
   - section 11: an audit trail of who changed what, and pagination on every table;
   - section 8: the Open questions screen and the dashboard's extra figures;
   - the handover package: a schema diagram, a seed made from their real files, a walkthrough of each screen, and
     a one-page work instruction.
3. **The biggest gap in the finance steps is the UAE account.** In Qirsh, a receipt can only go into a Sudanese
   pound account that takes customer payments. The brief needs customer payments into the UAE (Airwallex)
   account in dirham or dollars, and says these will grow. That needs a business rule from the client (at what
   rate such a payment settles an order priced in dollars and pounds), and about 8 to 12 hours in milestone 4.
4. **The 306 hours hold overall, but they are spread unevenly.**
   - Remaining work comes to about 213 to 297 hours, plus about 20 hours of meetings, review rounds and messages.
     That is 233 to 317 hours against 306.
   - Go-live (28 hours planned) needs 28 to 45, and is the step most likely to run over.
   - Orders, Accounts and Release have slack.
5. **The architecture document could force rework.** The brief's section 10 data model is "a starting point, not a
   decision", and Qirsh differs from it in a few places, each for a reason. Examples:
   - quotes are stored as orders;
   - receipts are kept apart from the ledger;
   - there is no separate conversions table.

   If the document (around 2026-10-06) prescribes section 10 literally, the rework is unpaid. §5 lists each
   difference and the reason to keep it.
6. **Week 1 depends on things only the client can give:** the accounts, the confidentiality agreement and the
   files. The request is in §7, ready to send.

## 1. Acceptance tests (brief section 13)

A milestone is paid when its tests pass on the live system. On top of that, Michael must approve the pull request.

| Test | Milestone | In Qirsh | Risk | What to do |
| --- | --- | --- | --- | --- |
| Landed cost: the current Growatt shipment's costs, entered as they are, give the $270 inverter a cost of $303.58 | 6 | Reproduced on invented data (S-2026-014) | Medium: the real dossier has its own rounding, cost list and uplift scope | Get `Shamsy_Zending_Growatt_v24.xlsx` after the confidentiality agreement. Enter it on staging early and confirm $303.58 before milestone 6 is specified. Which costs take the 20% uplift is still open (NOTES.md question 9) |
| Margin: August 2026 gives $85,208 / $21,918 (25.7%) / $4,135 / $27,604 (30.3%), the same lines in euros, and the currency switch never changes records | 7 | Reports exist (gross, net before and after currency, per route, USD and EUR). Not tested against these figures | **High: the figures do not reconcile (see the Summary)** | Before milestone 7 is specified, get the August shipment files and the owner's own calculation. Agree in writing how "net before currency" is defined (with or without the uplift, which expenses) and what the 30.3% is a percentage of. NOTES.md question 7 already asks the uplift part |
| History: last month's report, change today's rate, run it again: identical to the last pound | 7 | Built: stored facts and month closing, with an automated check | Low | Keep the check as a test |
| Permissions: an adviser or marketing cannot get a cost price or margin on screen, through the API or from the database | 1 | Built: the `restricted` schema has no API grants, with checks | Low | Add pgTAP policy tests if Michael wants database-level proof |
| Duplicates: the same code twice is refused; the same code with another amount goes to open questions | 3 | Built (`receipt_conflicts`) | Low | Fold it into the full Open questions screen (§3) |
| Daily limit: receipts on one account above 15,000,000 SDG on the same Sudanese day trigger the warning | 4 | Built: Africa/Khartoum business day, flag and check | Low | None |
| Discounts: 2% sand, 4% red, 6% needs the owner's approval | 2 | Built and enforced in the database | Low | None |
| Release: an order that is not fully paid cannot be released | 5 | Built | Low | None |

## 2. Step by step: what Qirsh has, what is missing, and the hours

"Rebuild" means the work on screens that already exist:
- restyling them to the approved design;
- moving them onto the production sign-in;
- the tests Michael's acceptance criteria call for;
- the documentation written with each feature.

| # | Milestone (plan hours) | Already in Qirsh | Missing | Estimate, hours | Verdict |
| --- | --- | --- | --- | --- | --- |
| 1 | Platform setup, with the design (44) | Four roles in RLS; tenants; settings for bands, minimum rate, currencies and account kinds; account holders with aliases; English with every string in `messages/en.json`; a password sign-in on the hosted demo | Production repository in the client's organisation with the demo parts removed, CI, staging and production on their EU accounts (6-8). Supabase Auth with password reset, invitations, and the owner managing users, roles and deactivation; Settings lists users read-only today (6-8). Owner two-factor sign-in (3-4). Company details, logo upload, the calculation rate, an order-number prefix per adviser such as SA- and MA- (3-4). The design system and the four screens, with one approval round (14-18). The audit-trail base (3-4). Spec, review and docs (3-4) | 38-50 | Tight. The design is what can make it run over |
| 2 | Orders (30) | Fixed prices, the owner's override per line, minimum rate, bands, per-line approvals, frozen totals, payment instructions with WhatsApp share, quotes as orders | Order numbers per adviser prefix (Qirsh uses SO- for everyone). Rebuild | 15-22 | Slack of 8 to 15 hours |
| 3 | Receipts, with proof and status (34) | One row per code, proof photo, SHA-256 duplicate check, conflicts, many-to-many allocation, statuses, a forwarding alert | The Open questions model and screen: unknown account, a payer who matches no customer, same code with another amount (6-8). The outbox in IndexedDB with background, resumable photo upload; today it is in localStorage (4-6). Cash taken by staff from a customer, which has no transaction code (2). Rebuild (10-14) | 22-30 | Fits |
| 4 | Accounts, limits and movements (34) | Ledger with origin and destination, live balances, today's intake against the limit, transfers, payouts, pass-through at zero, statements, outstanding per exchanger | The UAE (Airwallex) account as a full account: customer receipts in AED or USD allocated to orders, conversions with their rate, supplier payments from it, and money held in USD or AED shown apart until converted (8-12). Rebuild (10-12) | 18-24 | Fits, but the UAE rule is a business decision (§6) |
| 5 | Release against paid orders (12) | Built: pick list without amounts, fully paid only, oldest lot first | Rebuild | 6-8 | Slack of 4 to 6 hours |
| 6 | Purchasing, landed cost and stock (40) | Invoices in USD or EUR with commission, costs in four currencies, 20% uplift, lots, movements, transit, minimum levels | Kits sold as one product: components, stock and landed cost (6-8). Own-brand model codes, SP and SWF, beside the supplier code (1-2). A product model ready for warranty and serial numbers, design only, per section 16 (1). Reproducing $303.58 from the real dossier (2-4). Rebuild (12-16) | 22-31 | Fits |
| 7 | Margin, profit and checks (36) | Gross, net before and after currency, per product, order, customer, adviser, shipment, month and route, in USD or EUR; 12 closing checks covering the brief's three; month closing | Weekly overview and grouping by week (3-4). The dashboard figures from section 8: what this shipment earned, where the cash is (customers, exchangers, stock), margin over recent months, return on stock, share of orders delivered from stock (6-8). Reconciling August with the real data (4-10, unknown until the files are seen). Checking the euro side against the cost factor and the actual payouts (2). Rebuild (10-12) | 25-36 | Tight. The August reconciliation decides it |
| 8 | Quotes and price lists (26) | Quote and price-list PDFs, WhatsApp share, validity, one click to an order | Statuses sent, accepted and expired; Qirsh has quote, converted and expired (2-3). Payment terms per quote, such as 50% upfront and 50% before delivery; Qirsh has one tenant-wide text (2). Made-to-order items against a deposit, never from stock, across orders, receipts and release (6-8). PDFs in the real house style (3-4). Rebuild (6-8) | 19-25 | Fits |
| 9 | CRM (22) | Segments A+ to D, pipeline, source, labels, notes, contacts with WhatsApp opt-in, revenue per dealer | Profile fields: owner, decision-maker, purchasing power, monthly volume, brand preference, current supplier (3-4). The brief's customer types and pipeline labels: consumer, trader, to verify, quote sent, paid (1-2). What the dealer still holds from our last delivery (3-4). Share of wallet: what else he sells, at what price, from whom (5-6). Filters by city, type and adviser; today the filters are search, segment and label (2). Rebuild (6-8) | 20-26 | Tight |
| 10 | Go-live (28) | Not built; the approach is in NOTES.md | Import with a dry run and a reconciliation report: opening balances, customer balances and open orders, stock with landed cost, and the cash-register ledger with its open questions (14-20). Production cut-over (2-3). The handover package (6-10; see §3). Full data export (2-4). Support during the two weeks of live testing (4-8) | 28-45 | **Over the plan.** The highest risk |
| | **Total** | | | **213-297** | Add about 20 hours of meetings, review rounds and messages: **233-317 against 306** |

### What this means for the held milestone plan

- **The total and the ten milestones can stay.** The work fits in 306 hours only if the import stays within the
  terms (records that break the rules go to open questions; nothing is reconstructed by hand) and the design
  closes in one approval round.
- **Go-live is the weak point.** Two options for the user to choose from:
  - **(a) Keep the amounts, and move work out of milestone 10 (recommended).**
    - The handover documents are written step by step, as the brief already asks ("documentation is written with
      each feature"). Only the schema diagram and the one-page work instruction stay in milestone 10.
    - The export moves to milestone 1, where it is mostly the client owning the Supabase project (§3).
    - Milestone 10 is then about 22 to 34 hours, close to its 28. The hours move to milestones that are paid
      when accepted, not held for two weeks.
  - **(b) Move about US$100 from milestone 2 or 5 to milestone 10.** This raises the payment held for the two
    weeks, which section 2 advised against.
- **Either way, name the floating items in the milestone descriptions** before the plan goes out (§3). Then none of
  them can arrive later as "it was in the brief".

## 3. Requirements outside steps 1 to 9

The terms (section 2 reply) define the scope as "steps 1 to 9 as written in the final brief, including the section
12 import and go-live and the section 13 acceptance tests". The brief's other sections are not named, but the client
can reasonably read "as written in the final brief" to include them. Most cost little. Arguing them out would cost
more goodwill than they cost hours. So the recommendation is to accept them and tie each one to a milestone now.

| Requirement | Source | In Qirsh | Tie to | Hours | Position |
| --- | --- | --- | --- | --- | --- |
| Owner two-factor sign-in | §14 | No | M1 | 3-4 | Accept: Supabase Auth supports TOTP; the owner role then requires it |
| Full export of all data at any time | §14 | No | M1 | 2-4 | Accept. The database is on Shamsy's own Supabase account, so a full export is theirs already; document it. Add a CSV export of the main tables from Settings |
| Daily backups with point-in-time recovery, paid plan | §14 | n/a | M1 (set-up) | 0 | The client's account and cost. Point-in-time recovery is a paid add-on in Supabase; say so in the week 1 message |
| Business day in Sudan time, timestamps in UTC, shown in the user's time zone | §14 | Built for the business day; display to confirm | M1 | 1 | Accept |
| Audit trail on orders, movements and stock | §11 | Partly: orders are immutable; `created_by` on orders, movements and stock; settings history | M1 (base), then each step | 3-4 | Accept |
| Every table paginated | §11 | Partly: lists take a limit, and customers also take an offset | Each step's rebuild | 2-3 | Accept |
| Works on 3G; entries survive a dropped connection | §11 | Outbox in localStorage, service worker, idempotent saves | M3 | inside M3 | Accept |
| The Open questions screen (unknown account, unmatched payer, code conflicts) | §8 | Only code conflicts | M3 | inside M3 | Accept |
| Dashboard: shipment result, where the cash is, return on stock, share delivered from stock | §8 | Partly: month result, cash per currency, exchangers, alerts | M7 | inside M7 | Accept |
| Handover: README with set-up and deployment, schema diagram, seed from real files, walkthrough of each screen, one-page work instruction | Handover | README and NOTES for the prototype | Docs per step; schema diagram and work instruction in M10 | 6-10 | Accept, and agree the walkthrough's form: screenshots and text per screen, not videos |
| Warranty and returns in the product model | §16 | No | M6 (design only) | 1 | Accept as design only; building it is new work |

Explicitly out, per the brief itself: steps 10 to 12, a native app, accounting export, automatic reading of
screenshots, and the Arabic interface (built for, not built). Keep that list handy: it is the brief's own words.

## 4. Where the gaps come from

Not from the hard parts. Qirsh already has what the brief cares about most: money as integers, frozen rates, rules
in the database, roles that cannot be bypassed, the ledger, and duplicate codes. The gaps are of three kinds:

1. **Breadth the prototype skipped.** Kits, share of wallet, profile fields, made-to-order items, quote statuses,
   weekly grouping.
2. **Production plumbing.** Real sign-in with reset, invitations and two-factor; the audit trail; pagination;
   export; offline storage that survives a closed app.
3. **The real data.** August's figures, the Growatt dossier, and the cash register. Only these can settle the
   acceptance tests, and they arrive only after the confidentiality agreement. **Getting them early is the single
   most useful thing in week 1.**

## 5. The data model against brief section 10 (for the architecture document)

Use this list when the architecture document arrives.
- **Same idea, different name:** keep it, and map the names in the documentation.
- **Different design:** defend it with the reason given here. Accept a change only if Michael insists, and then
  name the cost before building it.

| Brief section 10 | Qirsh | Kind | Reason to keep Qirsh's version |
| --- | --- | --- | --- |
| `users` with role, language, order prefix | `profiles` plus `memberships` (role per tenant) | Different design | One person in several tenants is how dealer access (step 12) becomes a switch. Add language and prefix to the profile |
| `products` with purchase, landed, list and manual prices | `products`, `product_prices` with `price_history`, landed cost in `restricted` | Different design | Cost prices are out of reach of the API by construction, which is the permissions acceptance test |
| `kits`, `kit_lines` | Missing | Gap | Build as in the brief (M6) |
| `customers` with the CRM fields | `customers`, `customer_contacts`, labels | Partly | Add the missing fields (M9) |
| `quotes`, `quote_lines` separate from orders | Orders with `kind = 'quote'` | Different design | One pricing and approval path for both, which keeps the rules identical. Quote-only fields (terms, status) fit on the same row |
| `accounts`, `account_aliases`, `exchangers` | `accounts`, `account_kinds`, `account_holders`, `holder_aliases` | Same idea | Account kinds are settings, as the brief's white-label principle asks |
| `movements`: one ledger with transaction code and proof status | `receipts` (code, proof, status) plus `ledger_entries` (origin and destination) | Different design | A proof's life (received, forwarded, confirmed, conflict) is not a money movement. Keeping it apart keeps the ledger append-only |
| `movement_allocations` | `receipt_allocations` | Same idea | |
| `shipments`, `shipment_lines`, `shipment_costs` with cost factor | `shipments`, `shipment_lines`, `restricted.shipment_finance` and `shipment_costs` | Same idea | Costs live in `restricted` |
| `stock_movements` | `stock_lots` plus `stock_movements` | Same idea, with more | Lots give oldest-first release and landed cost per lot |
| `exchange_rates` with calculation rate and actual rates per exchanger | `reference_rates` per day and currency, `settings_history` for the minimum rate; actual rates on each payout | Same idea | Add the calculation rate (M1) |
| `conversions` | Ledger entries of kind `conversion`, with the currency result in `restricted.fx_facts` | Different design | One ledger, so every conversion is also a balance movement |
| `open_questions` | `receipt_conflicts` only | Gap | Generalise it (M3) |
| Timestamps, soft delete and `created_by` everywhere | Timestamps and `created_by` on money and stock; history rows are immutable; no soft delete | Different design | Money history is never deleted, only reversed by a new entry. Soft delete fits reference data (products, customers, accounts), and is cheap to add there |

**Already the same as the brief** ("How we build"): Next.js with TypeScript in an Nx monorepo, Supabase, Tailwind,
Vercel, GitHub Actions and reviewed pull requests. Nothing to defend there.

## 6. Questions for Michael and the client

Most of these go into a milestone's acceptance tests, so they can wait until that milestone is specified. The ones
marked **early** change the data model or decide a payment, so they should be asked in the first two weeks.

**Early**
1. **The August margin figures (M7).** $27,604 is 32.4% of $85,208, and gross plus the currency result is $26,053.
   - Which definition gives 30.3%?
   - Is the 20% uplift added back in "net before currency"?
   - Which expenses are in?
   - Ask for the August shipment files and the owner's own calculation.
2. **The cost factor (M6, M7).** The brief's inputs give 0.860122, but the brief uses 0.860234. Which one is
   right, and how is it worked out?
3. **Customer payments into the UAE account in AED or USD (M3, M4).** At what rate does such a payment settle an
   order priced in dollars and pounds? Is it the order's own rate through the dollar, or the day's AED rate? Who
   records it?
4. **Made-to-order items against a deposit (M2, M5, M8).**
   - What deposit?
   - Is the balance due before delivery?
   - Does release still need full payment?
   - Is stock ever reserved for them?
5. **Kits (M6).**
   - Is the price set for the kit, or the sum of its parts?
   - Does a discount apply to the kit as a whole?
   - Does release take each component from stock?
6. **Order numbers (M2, M10).** Keep SA- and MA- per adviser, so the imported open orders keep their numbers?

**When each milestone is specified**
7. Quote statuses (M8): what marks a quote "sent" (sharing it?), and who marks it "accepted"?
8. Share of wallet and the dealer's remaining stock (M9): who records them, and how often?
9. The Open questions screen (M3): is the brief's list (unknown account, unmatched payer, code conflicts) complete?
10. The handover walkthrough (M10): are screenshots with text per screen enough?
11. The ten questions already in `qirsh/NOTES.md`, "Rules I read one way and would confirm":
    - rates as whole pounds;
    - the band boundaries;
    - what an approval covers;
    - quote expiry;
    - the daily limit as a warning and the 3,000,000 cap as a rule;
    - bank plus code uniqueness;
    - the currency result;
    - the euro dates;
    - which costs take the uplift;
    - one receipt paying for two dealers.

## 7. Week 1 request (ready to send in the group)

This is a request, not a reply to a topic, so it can go out now. If the client raises milestones in the same
conversation, send the held plan (section 7) first and this right after it.

> Hi,
>
> To set the project up on your side, here is what I need this week. Most of it takes a few minutes in each
> service.
>
> 1. Supabase: a project in an EU region on Shamsy's own account, on a paid plan, with me invited. Your brief asks
> for point-in-time recovery; in Supabase that is an add-on with its own monthly fee, switched on in the billing
> settings.
> 2. Vercel: your team, with me added, for staging and production.
> 3. GitHub: a repository in your organisation, with Michael as reviewer and me with write access. The database
> deployment needs three values in the repository settings: SUPABASE_PROJECT_ID as a variable, and
> SUPABASE_ACCESS_TOKEN and SUPABASE_DB_PASSWORD as secrets. Please have Michael or yourself enter them there, so
> no keys go through chat.
> 4. The confidentiality agreement, to sign. After that, your files: the sales tool, the daily administration, the
> Growatt shipment dossier, the cash register with a sample of the screenshots, and the price list. The August
> shipment matters most, because the margin test in your brief uses its figures, and I want to agree with Michael
> how they are calculated well before that step.
> 5. The people who will use the system: name, email and role for each, and the order prefix of each adviser (SA-,
> MA-).
> 6. Brand assets: the logos with and without the Arabic wordmark, the colours and the fonts.
> 7. The settings to start with: discount bands at 3% and 5%, today's minimum rate and the calculation rate.
>
> Once the accounts are in place, I set up staging and the design screens go there for your approval. Until then I
> work on the design and the specification of each step.
>
> Valdis

**Prep notes**
- **Point-in-time recovery** is a paid add-on in Supabase. Check its current terms on Supabase's pricing page before
  sending, in case they changed.
- **Never take keys by chat.** The client or Michael enters the secrets in GitHub.
- **"Me with write access" means the account the user works under.** The friend does not get credentials of the
  user's.

## 8. The friend's ten days (2026-10-01 to about 2026-10-11)

In order of priority. Each item says what it depends on.

1. **Send the week 1 request (§7)** when it suits the conversation in the group. It depends on nothing.
2. **Design first look.** Build the design tokens from `client-files/shamsy-dashboard-v2.html` (green `#0E3B2E`,
   gold `#C9922E`), and restyle the order screen and the orders list in the Qirsh code at 390 px.
   - Show them as screenshots and a short captioned recording, with invented data only.
   - Commit in this private repository. Never push Shamsy branding to our demo repository
     (`Tony-aphrodite/9-26-test-demo`), and never deploy it to qirsh-live or qirsh-demo. The client is confidential.
   - When the client asks about the design, use the held message (`chatting.md` section 8), adapted.
3. **Milestone 1 specification and acceptance tests**, drafted for Michael from §2 and §3 of this review:
   sign-in, reset, invitations, two-factor for the owner, roles, settings, export, the audit-trail base, and the
   four screens. Hold the repository structure, sign-in and hosting choices until the architecture document is in.
4. **The architecture document,** around 2026-10-06. Go through §5 row by row, and raise any conflict with the Qirsh
   base in writing within a day or two. At a fixed price, rework is unpaid.
5. **The early questions (§6, 1 to 6).** Ask them when the files arrive, or together with the milestone 1
   specification.
6. **Log every session in `WORKLOG.md`** with "(friend)" in the row.

Money, the split of the US$4,000 and anything beyond the brief wait for the user (`HANDOFF.md`, first section).
