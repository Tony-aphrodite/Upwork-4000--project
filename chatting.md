# Shamsy (the "Full-stack Next.js and Supabase developer" job): client chat

The conversation log for this project. Each new client message is added at the bottom with an analysis and a
suggested reply. The bid for this job was made with the Trelvane demo, which is why the folder carries that name.

Since 2026-10-01 the conversation also runs in a group chat with the client. Messages from the group are logged here
the same way, and each section says whether its message came from Upwork or from the group. Payments and milestone
approvals stay on Upwork.

## Project summary

- **Job:** a full-stack Next.js and Supabase developer for a multi-tenant business platform. Bid on 2026-09-23 with
  https://trelvane-platform.vercel.app (Postgres in the browser, Supabase-shaped auth, roles and RLS, 13 live
  isolation checks, an encrypted credential vault, an installable PWA).
- **The real client, revealed on 2026-09-24:** Shamsy, a solar equipment importer selling into Sudan. The brief is
  marked confidential and for shortlisted candidates only.
- **Files received:** `client-files/Shamsy_Project_Brief_final.pdf` (16 pages, also extracted as `.txt`) and
  `client-files/shamsy-dashboard-v2.html`, the HTML dashboard prototype that carries their layout, colours and
  typography.
- **Proposal claims already made (Proposal.md):** three live Next.js apps as my own builds rather than client
  production systems, tenant resolved through membership tables in policies rather than from the request, an
  isolation suite as a first-class test file, a PWA that never caches API responses, Claude Code inside a review
  and test loop with five named mistakes I caught, solo, fixed price per sprint. The rate figures in that file are
  still placeholders, so whatever was actually sent needs recording here.

## Warnings

1. **Nothing invented.** The proposal says plainly that the three portfolio apps are my own builds and that none
   runs on hosted Supabase. Keep that line; it is why the demo exists.
2. **Confidentiality.** The brief says their data and screenshots are shared only after a signed agreement. Do not
   put Shamsy's name, numbers or files into anything public, including a demo repository or a deployed page.
3. **Pricing.** The trial fee of $100 is theirs, not ours, so accepting it is fine. Nothing else about rates or
   milestone prices has been agreed with the user yet.
4. **Their data is real money.** Every number in this brief comes from their own books. Do not repeat their figures
   back with corrections that have not been checked against the arithmetic.

---

## Conversation

### 1. Client to Valdis (received 2026-09-24): the confidential brief and the prototype

Two files, no covering text recorded: the 16-page project brief and the HTML dashboard prototype.

#### What the business is

Shamsy imports inverters, batteries, solar panels, balance-of-system parts, solar air conditioners and solar water
pumps from Saudi Arabia, China and the UAE, and sells them to about 570 dealers and installers in Sudan. They do
not install. Goods arrive at Port Sudan, clear customs and are trucked to a warehouse in Omdurman. The war cut
national generating capacity from 4,400 MW to about 1,100 MW and blackouts run to eighteen hours a day, so demand
is not the problem. Their words: "Cash, currency and coordination are."

#### What they are actually asking to be built

An internal business platform, in five parts, built in nine steps, each step a payable milestone.

| Part | What it holds |
| --- | --- |
| Foundation | Login, users, four roles enforced in the database, environments and branding, and every business rule as a setting |
| Finance | Orders, receipts and proofs, accounts and daily limits, currency conversion, margin and profit, reports and closing checks |
| Stock | Products, purchasing and shipments, landed cost, stock levels, release against paid orders |
| Communication | Customers and history, quotes and price lists, WhatsApp later |
| Dashboard | No data of its own; shows what the three modules hold, per role |

Steps 1 to 9 are this project: platform setup, orders, receipts with proof and status, accounts and limits and
movements, release against paid orders, purchasing and landed cost and stock, margin and profit and checks, quotes
and price lists, CRM. Steps 10 to 12 are explicitly out of scope but must not require a rewrite: WhatsApp Business
API, Arabic right-to-left, and dealer access.

#### The part that decides who wins this job

This is not a CRUD project. Six constraints carry the whole thing, and every one of them is a database decision
before it is a screen.

1. **Four currencies, and a cost factor that is frozen at the moment of exchange.** Euros to dollars to stock to
   Sudanese pounds and back to euros. Each shipment gets its own factor and it never changes afterwards, because
   the euros were spent on the day of the exchange. Their August 2026 example: 1.1674 dollars per euro with 211
   euros of commission, so every dollar of goods cost 0.860234 euros, and $59,983 of goods checks back to €51,599
   against the €51,593 that went in.
2. **History must never move.** Every order line, receipt and conversion stores its amount, its currency and the
   rate of the day it happened. An order placed at 8,000 SDG per dollar still reads 8,000 in six months when the
   rate is 11,000. Their acceptance test: run last month's report, change today's rate, run it again, and every
   number must be identical to the last pound. Money is stored as integers in the smallest unit.
3. **Book per event, with accounts as balances.** Customer to the owner's operating account is one line; that
   account to an exchanger is a second; the exchanger to the owner's euro account is a third. Never post a movement
   under its final destination and skip the intermediary, or the intermediary becomes uncheckable.
4. **The transaction code is the key to the whole administration.** Payment proofs arrive as Arabic Bank of
   Khartoum screenshots over WhatsApp, often twice. Each carries a unique code, so duplicates are harmless. The
   same code with a different amount must not be resolved by the software: show both to the owner.
5. **Account capacity is a daily, per-account constraint.** A Sudanese account takes about 15,000,000 SDG a day and
   a single transfer is capped at 3,000,000, so one payment arrives as five transfers across eleven accounts held
   by four exchangers, plus the owner's own account and a UAE account run through Airwallex. Pass-through accounts
   must stand at zero.
6. **Role visibility is enforced in Postgres, not in the interface.** Advisers and marketing must never see a cost
   price or a margin: "not on screen, not through the API, not by querying the database." The warehouse sees no
   financial data at all.

Everything else follows from those: discounts banded at 3% and 5% with owner approval above 5%, a minimum exchange
rate that is a setting the owner changes almost daily rather than a constant in code, release only against fully
paid orders, an open-questions list where nothing is booked until the owner answers, a Sudan business day for the
daily limit with timestamps stored in UTC, phone-first on 3G with dropped connections, numbers that are never
parsed as dates, pagination for tens of thousands of movements, and an audit trail on orders, movements and stock.

#### What they already have, and what it teaches

Four working tools encode how the business runs today, and the brief says to read them before designing anything:
the offline Arabic sales tool in a single HTML file (fixed dollar prices, no cost or margin visible, a minimum rate
enforced three ways, hard-coded at 8,000 which is exactly what must become a setting), a thirteen-sheet daily
administration workbook, a shipment dossier that spreads freight, customs, bank charges and inland transport over
products pro rata with a 20% uplift on indirect costs, and a cash register built from 211 payment screenshots. The
failure they are buying their way out of is in the brief: 64 payment proofs against 22 orders in three currencies,
a summary sheet that missed 38 transactions worth 103,803,000 SDG, exchanger tabs missing 8 more, Excel reading
decimals as dates, and one account holder's name spelled five ways.

#### The dashboard prototype

`shamsy-dashboard-v2.html` is a single static file, no scripts, no dependencies. It carries the house style: dark
green #0E3B2E with a second green #14503C, gold #C9922E, ink #16202B, a system font stack, a 250 px sidebar
grouped as purchasing and stock, sales and customers, payment and exchange, result and control. The page shows an
alert strip, trading result in dollars beside effective result in euros with the currency result explaining the
gap, today's receiving capacity per account as bars against the 15,000,000 limit, outstanding at customers and at
exchangers, the six lowest stock lines, a WhatsApp panel and a monthly gross margin chart.

Three things worth noticing rather than copying:

- It is written in Dutch, while the brief says the interface is English in phase one and Arabic later. The owner
  works in English and Dutch; the team in Sudan does not. Worth confirming which language the first screens are in.
- Its rate reads 6,250 SDG per dollar, which is the June figure; the brief says above 8,000 by September. The file
  even labels itself as illustrative. It is a layout reference, not a data reference.
- It shows a WhatsApp inbox, which step 10 puts outside this project. The dashboard should not imply that scope.

---

### The immediate ask: the paid trial task

Before awarding the project, each shortlisted candidate builds one screen: **where a sales adviser records an
order.** Six to eight hours, $100 on delivery whether or not they continue, three working days from receiving the
task.

**The rules the screen must enforce.** Dollar prices are fixed and the adviser cannot change them. Discount is per
line and is measured as a percentage of that line's value: above 0% to 3% the line turns sand and saves, above 3%
to 5% it turns red and still saves, above 5% saving is blocked until the owner approves that line. The exchange
rate is one number for the whole order, converts dollars to pounds, has nothing to do with discounts, and can never
go below the minimum of 8,000 SDG per dollar, snapping back if a lower number is typed. A saved order never
changes: the rate is stored on the order.

**Their worked example, checked line by line.** It is internally consistent, which is worth knowing before
building against it:

| Line | Quantity and price | Line value | Discount | Percentage | Band | Line total |
| --- | --- | --- | --- | --- | --- | --- |
| SPF 6000 ES Plus | 4 × $515 | $2,060 | $40 | 1.9417% | sand | $2,020 |
| Hope 5.0L-B1 | 2 × $810 | $1,620 | $70 | 4.3210% | red | $1,550 |
| Hope 16.0LM-A1 | 1 × $2,070 | $2,070 | $150 | 7.2464% | blocked | $1,920 |

Without line three the order is $3,570, which at 8,200 is 29,274,000 SDG. With line three approved it is $5,490,
which is 45,018,000 SDG. Both multiply out exactly, with no rounding decision hidden in them. Reopening after the
rate setting moves to 9,000 must still show 8,200 and 45,018,000.

**What they judge.** The worked example gives exactly those numbers; the 5% block cannot be bypassed even by
calling the server directly; a saved order does not change when the rate changes; money is stored in cents and the
rate is stored on the order; it works on a phone; and the note shows the candidate understood the problem.

**What is delivered.** A link to the working screen on the candidate's own Vercel and Supabase, access to the
repository, a screen recording of five minutes or less walking through the worked example, and a short note saying
what would be done differently in the real system and anything in their rules that seems unclear or wrong.

**Section 17, which is where the project is actually won.** They ask for opinions on six things: whether to extract
the transaction code, amount, accounts and comment automatically from Arabic bankak screenshots and at what point
that pays for itself; how an adviser allocates one receipt across several orders quickly on a phone; whether
storing the rate on each order and movement is the best way to keep reports stable; how much of today's offline
behaviour is lost and how order entry survives a dropped connection; what would make dealer access a switch rather
than a rewrite; and what they will regret in six months that they cannot see now. Their framing: "We are traders,
not software people. Tell us where we are wrong."

#### Analysis: what they want, in order of what it costs to get wrong

1. **Arithmetic they can check.** Every acceptance test in the brief is a number from their own books. They are not
   testing whether the screen looks good; they are testing whether the developer can be trusted with money.
2. **Rules that live where they cannot be bypassed.** The 5% block, the minimum rate and the role visibility are
   all stated as server or database requirements. A candidate who enforces them in React has failed the test even
   if the demo looks identical.
3. **A frozen past.** Storing the rate on the order is the one instruction they repeat in three different sections.
   It is also the thing most systems get wrong by joining to a current rates table.
4. **Someone who argues back.** Section 17 and the closing line of the trial both ask for disagreement. The note is
   half the assessment and it is the half most candidates will treat as a formality.
5. **Phones on bad connections.** The advisers work on phones in Dongola and Khartoum. A save that fails silently
   when the connection drops is worse than no system.

#### Things in their rules worth raising in the note

- **Band boundaries.** "Above 0% and up to 3%" and "above 3% and up to 5%" make exactly 3% sand and exactly 5% red.
  Computed in floating point, a $60 discount on a $2,000 line is not reliably 3%. Do the comparison on integers:
  discount × 100 against line value × band, so the boundary is exact.
- **Rounding of the pound total.** Their example multiplies out exactly, so the brief never has to say whether SDG
  is rounded per line or on the order total, and whether to the pound or below it. On a real order it will matter.
- **Same code, different amount.** Their rule is to show both and book neither. That needs a status on the receipt
  rather than a rejected insert, or the second screenshot is lost.
- **Pass-through accounts standing at zero** is a closing check, not a constraint: a payment can sit there
  overnight. Enforcing it as a rule would block legitimate entries.
- **The prototype is in Dutch while the interface is to be English.** Confirm which language ships first, because it
  changes nothing technically and everything for the team in Sudan.
- **The minimum rate is currently hard-coded at 8,000 in their sales tool.** In the new system it has to be a
  setting with a history, because a report from June has to know what the minimum was in June.

#### Suggested reply (ready to send)

> Thank you, both files arrived and I have read the brief end to end and been through the dashboard prototype.
>
> I would like to do the paid trial task and I can deliver it within the three working days, on my own Vercel and
> Supabase, with the repository, the five minute recording and the note.
>
> Two things I checked before saying yes: your worked example is internally consistent, 1.94%, 4.32% and 7.25% land
> in the three bands exactly as you describe and both order totals multiply out to the pound, and the rules that
> matter are the ones that have to live in the database rather than in the browser, which is where I will put the
> five per cent block, the minimum rate and the stored order rate.
>
> One question so I build the right thing: the prototype is in Dutch and the brief says English first with Arabic
> later, so which language do you want on the trial screen?
>
> In the note I will answer the six questions in section 17 and list the places where your rules need one more
> decision, including how the pound total is rounded and what happens to the second screenshot when the same
> transaction code arrives with a different amount.
>
> Valdis

#### Build checklist for the trial task, if it goes ahead

Stack, because they will look: Next.js with TypeScript, Supabase, Tailwind, deployed on Vercel, with the repository
public or shared.

1. **Schema.** `products` (sku, name, price_usd_cents), `customers`, `settings` (min_rate_sdg, with history),
   `orders` (customer, adviser, rate_sdg_per_usd stored on the row, status), `order_lines` (product, quantity,
   unit_price_usd_cents copied at the time of sale, discount_usd_cents, approved_by). Money as integers in cents,
   rate as an integer, timestamps in UTC.
2. **Rules in Postgres.** A check or trigger that refuses a line whose discount exceeds five per cent of its value
   unless `approved_by` is set by a user with the owner role; a check that the order rate is not below the minimum
   rate setting; RLS so an adviser can only touch their own orders and cannot read cost prices, which for the trial
   means no cost column is readable by the adviser role at all.
3. **Server, not browser.** The save goes through a server action or an RPC that re-validates everything. The test
   they will run is a direct call that tries to save a blocked line.
4. **Frozen rate.** The order stores the rate. Reopening after the setting changes must show the stored one. Write
   that as a test rather than checking it by hand.
5. **Screen.** Pick customer, add lines, quantity and discount per line, colour band per line, order totals in
   dollars and pounds, the rate field with the snap-back behaviour, a save button that refuses while a line is
   blocked, and an owner view that can approve a line. Phone width first, thumb-sized controls, thousands
   separators, no layout that breaks at 360 px.
6. **The recording.** Walk their worked example in their order: the three lines, the blocked save, removing line
   three, the two totals, the owner approving, the rate change, the refused 7,900.
7. **The note.** Section 17's six questions, the rounding question, the duplicate-code question, the band
   boundaries, and one paragraph on what I would do differently in the real system.

#### Open questions for the user before any of this is sent

1. Was the proposal sent with real numbers in place of the `$[trial]` and `$[sprint]` placeholders, and if so what?
2. Is there a Supabase account available for the trial, or does one need creating?
3. Has a confidentiality agreement been signed, or is one expected before the trial?

---

### 2. Client to Valdis (received 2026-09-28): the terms before the award

Hi Valdis,

Your breakdown for steps 1–9 comes to $4,000 and approximately 306 hours. Before we move forward, I just want to
make sure we're fully aligned on the terms, as these points are important for my decision:

1. I understand the $4,000 to be a firm, fixed price for the complete delivery of steps 1–9 as currently scoped,
including the final go-live/import. So it's not an estimate that can increase based on the actual hours required.
Anything genuinely outside the agreed scope would, of course, be discussed and approved separately in advance.

2. Payment will be milestone-based and held in escrow. Each milestone will only be released after the work has
been delivered and our technical lead has reviewed and approved the pull request for that milestone. So passing
the acceptance criteria alone isn't enough; his technical sign-off on the delivered code is also required.

3. I'd also like a warranty period after each accepted milestone. Please confirm how long you can offer and that
it covers bugs or defects in the functionality delivered within the agreed scope — not new features or additional
requests.

4. For the final go-live milestone, I'd like a two-week live testing period after deployment. The final payment
would be released after that period, provided the system is functioning as agreed and any material bugs or
defects within the agreed scope have been resolved.

If 1, 2 and 4 stand as above and we can agree on 3, the project is yours (after a meeting with my technical lead
and his approvoal) I'm not looking to negotiate the price further or continue shopping the project around after
that — I'd rather agree on clear terms upfront and then focus on getting this built successfully together.

#### Analysis

**This is an offer to award, conditional on four terms and a meeting.** He has stopped comparing candidates and
says so. What is left is the contract, and the contract he describes puts every risk on the developer: a fixed
price, payment gated on another person's approval, a warranty, and the last payment held back after go-live.
None of the four is unreasonable on its own. Together, with loose definitions, they are how a fixed-price job
turns into unpaid months. The reply should accept all four and pin down the words that decide who carries the risk.

**The economics, for the user only.** $4,000 for about 306 hours is roughly $13 an hour, fixed. He has said he
will not negotiate the price further, and the user quoted it, so the reply does not reopen it. It does mean there
is no slack for scope drift, which is exactly what the definitions below protect against.

**Point 1, fixed price: accept, and define "as currently scoped".** The scope should be the written brief
(`Shamsy_Project_Brief_final`, steps 1 to 9, section 12 going live, section 13 acceptance tests) plus the
per-milestone acceptance tests agreed before each milestone starts. Two things in it are open-ended and need a
boundary:

- **The go-live import.** Section 12 asks for opening balances, customer balances, open orders, stock with landed
  cost, and the ledger rebuilt from the payment screenshots "with its open questions". The brief's own history is
  64 proofs against 22 orders, 38 missed transactions and one name spelled five ways. Importing is fixed-price
  work; deciding what the right answer is for a messy record is not, and cannot be, because only the owner can.
  The reply should say: I import and reconcile, and every record the rules refuse lands on the open-questions
  list for the owner to decide, which is exactly how the brief says the system works.
- **The technical lead writes the specs.** The brief says every feature is defined in advance by him with a goal
  prompt and acceptance tests. If those specs grow beyond the brief, that is a scope change, even if it arrives as
  a spec rather than a request. The reply should say that specs are agreed before a milestone starts, and that
  anything in them beyond the brief is handled under his own "discussed and approved separately" clause.

**Point 2, escrow and the technical lead's sign-off: accept, and make the sign-off something that can be met.** A
sign-off that is required but undefined is the one real danger in this message: it lets payment wait on taste. The
reply should ask for three things, framed as making his review easy rather than as protection: the review checks
the code against the agreed acceptance tests and the standards in the brief (TypeScript, tests with every change,
reviewed pull requests, GitHub Actions green, documentation written with the feature); review comments come back
in one consolidated round within a few working days; and changes asked for in review are fixed as part of the
milestone as long as they are within scope and those standards. Upwork's fixed-price escrow already has its own
review window, so there is no need to mention auto-release; asking for a review window of five working days is
enough and sounds cooperative.

**Point 3, warranty: this is the only open term, and the brief already answers it.** Section 14 says "Sixty days
of free fixes after final handover, for anything that does not work as specified." He is now asking for a warranty
after each milestone. The clean offer, consistent with his own brief: every accepted milestone is covered from the
day it is accepted until sixty days after the final go-live. That gives early milestones a long warranty and costs
little, because a defect found in step 2 during step 5 is cheaper to fix then than later. It must say what is
covered (does not work as specified in the brief and the agreed acceptance tests) and what is not (new features,
changes to agreed behaviour, problems caused by changes made by others to the code, data or Supabase settings,
outages of Supabase or Vercel, and data that was wrong in the source spreadsheets), plus a response time.

**Point 4, two weeks of live testing: accept, and fix when the clock starts and what "material" means.** The
period should start on the go-live date, and the final payment is released at the end of it once any material
defects reported within those two weeks are fixed. "Material" should mean something that stops the platform being
used as specified or produces a wrong figure, not a cosmetic preference. Go-live also depends on inputs only they
can give: the opening balances confirmed by the owner on the switch-over date and his answers to the open
questions. The reply should say go-live is scheduled once those are in, so a delay on their side does not become a
delay charged to the final milestone.

**The meeting with the technical lead is the real decision.** Prepare for it as an interview on the code: how RLS
enforces the cost-price rule, how history is frozen, how the transaction-code duplicates work, how the import will
be reconciled. The trial task and the hosted Qirsh are the evidence.

#### Suggested reply (ready to send)

Hi,

Thank you, that is clear, and I would rather agree terms properly now too. Yes to all four, with the definitions
that make each one easy to apply.

1. Fixed price. Yes, $4,000 is a firm fixed price for steps 1 to 9 as written in the final brief, including the
section 12 import and go-live and the section 13 acceptance tests. It does not move with the hours. I would add
one thing so we both read "as currently scoped" the same way: before each milestone starts, your technical lead and
I agree its acceptance tests in writing, as the brief already describes. Anything in those specs that goes beyond
the brief is handled the way you describe, discussed and approved separately first. For the import, I do the
import and the reconciliation. Where an old record breaks the rules, for example the same transaction code with
two amounts, it goes onto the open-questions list for the owner to decide, which is how the brief says the system
should work anyway.

2. Escrow and code sign-off. Yes. Each milestone is released after delivery and your technical lead's approval of
the pull request. To keep that quick for him, I would suggest he reviews against the milestone's agreed acceptance
tests and the standards in the brief: TypeScript, tests with every change, reviewed pull requests, GitHub Actions
green, and documentation written with the feature. It would help if his comments came back in one round within
about five working days. Anything he asks for within scope and those standards I fix as part of the milestone.

3. Warranty. Your brief asks for sixty days of free fixes after final handover. I will give that to every
milestone: each one is covered from the day you accept it until sixty days after the final go-live, so the first
milestones get the longest cover. It covers anything that does not work as specified in the brief and the agreed
acceptance tests. It does not cover new features or changes to agreed behaviour, problems caused by someone else
changing the code, data or Supabase settings, outages at Supabase or Vercel, or figures that were already wrong in
the source spreadsheets. I reply to a reported defect within one working day, and a defect that blocks work comes
first.

4. Two weeks of live testing. Yes. The two weeks start on the go-live date, and the final payment is released at the
end of them once any material defect reported during those two weeks is fixed, meaning anything that stops the
platform being used as specified or gives a wrong figure. Go-live itself needs two things from your side, the
opening balances confirmed by the owner on the switch-over date and his answers to the open questions from the
import, so we schedule it once those are in.

I am happy to meet your technical lead whenever suits him. If it helps him prepare, the trial task and the hosted
version of the platform demo show how I would handle the parts he will care most about: roles enforced by the
database, history that never moves, and duplicate payment codes.

Valdis

#### Prep notes

- **Decision for the user before sending: the warranty length.** The draft offers each milestone cover from its
  acceptance until sixty days after go-live, which matches section 14 of their brief. It is generous but cheap if
  the code is tested. If the user prefers less, the fallback is "sixty days after final handover for everything,
  and thirty days after acceptance for each milestone before then", but the draft's version reads as the obvious
  yes and helps close.
- **Response time.** "Within one working day" is a commitment. Keep it only if it is true for the user's hours.
- **Do not reopen the price.** He said he will not negotiate further; neither should we. $4,000 for about 306 hours
  is about $13 an hour, which is the user's call and already made.
- **Milestone amounts.** The reply does not restate the per-milestone split. Make sure the Upwork milestones match
  the breakdown already sent, and that the final go-live milestone, the one held for two extra weeks, is not a
  disproportionate share of the $4,000.
- **For the technical-lead meeting:** be ready to walk through RLS for the cost-price rule (adviser and marketing
  cannot read it through the API or the database), frozen rates on orders, integer money, the transaction-code
  duplicate and conflict path, the Sudan business day for the daily limit, and how the import will be reconciled
  per account and per customer against the owner's confirmed balances. Nothing about past client work should be
  claimed; the demos are the evidence.
- **Confidentiality.** The brief says data is shared only after a signed confidentiality agreement. If the import
  needs their spreadsheets, that agreement has to be in place first; raise it in the meeting if nobody else does.

---

### 3. Call with the client, 2026-09-29 (plus a written message before it)

**His written message, before the call (verbatim):**

> Can i share your trial tool (without causing harm for ourself) to other candidates who applied for the job and
> sent in there trial. At lot of them put in work and are not getting the project at least i want to shem them why
> they didnt get the project and why that one is the winner. This wont influence my choise on you either, i allready
> gave all candidates (including you) a chance to improve their work. Especially because al lot put in unoaid work
> at least i want them to be able to learn. I will aslo share work of some other candidate with youu (after he ha
> gave his permission), so that you and the team can learn from his design. Cause based on design the work of your
> team wasnt the best.

**The call, project content only** (small talk about the camera and health left out; full transcript kept by the
user):

1. **Award.** "If it depends on me, you will get the project." Two conditions remain: a meeting with the technical
   lead, who reviews the delivery scope and the pull requests on his behalf ("if he's good, we are good"), and
   improving the design of the tool. Valdis: yes, as long as he says exactly what he wants.
2. **Sharing the trial with rejected candidates.** He asked whether it harms us. Valdis advised against sharing code
   and suggested a video; then suggested he record his own point-of-view video. He answered that showing the
   winning work is the only practical way, and offered to pay "like 75 dollars" for a short video he can share
   safely. Valdis: will consult the team. He wants the answer today or soon.
3. **What won it, in his words.** Security (many candidates were dropped for weak security) and "thought beyond the
   scope, a full system". Design was not the best.
4. **Another candidate's design.** He will offer that candidate payment, and with permission share his work so the
   team can learn from its flow and layout. Valdis: useful, we can use it as a template.
5. **Technical lead meeting.** Today or tomorrow; the lead (named Michael later in the call) will "review the
   delivery scope and the pull requests". Valdis said he would not be able to talk about details because he is not
   fully aware of the project or scope, and that the team is in China and writes better than it speaks English.
6. **Group chat.** He asked for a WhatsApp group; Valdis raised Upwork's policy and proposed Telegram; he will check
   with Michael. Valdis also suggested sharing an Upwork account with a trusted person, "like I do with my teams".
7. **Timing.** Valdis: "it will be done as soon as it will be done." Him: "I don't like that thing."
8. **Using each step as it is finished.** He asked whether they can use the platform as each scope is finished.
   Valdis: most likely, once the live system is set up; changes shown on Vercel, approved, then released to live.
9. **Europe, China and hosting.** He responded to us partly because we are based in Europe; he does not mind the team
   working from China, but the technical lead asked about European rules on where servers are hosted. Valdis: who
   works on it has nothing to do with regulation; "if you want to serve clients in the EU, your servers have to be in
   the EU".

#### Analysis

**The job is effectively won; two gates are left, and one of them is the technical lead.** The client has decided.
What is left is a meeting with the person who will also approve every pull request under the terms agreed on
28 September. That meeting matters more than anything else in this conversation, and it is the one place where the
call went badly: saying "I'm not fully aware of the project or the scope" to the client, about the meeting with the
reviewer of the code, is the sentence most likely to lose it. The fix is preparation in writing, sent before the
meeting, so the lead has something concrete to react to.

**One statement on the call was wrong and should be corrected in writing before the technical lead repeats it.**
"If you want to serve clients in the EU, your servers have to be in the EU" is not what the GDPR says. The GDPR does
not require data to sit on EU servers; it controls transfers of personal data outside the EEA, and giving someone
outside the EEA access to that data counts as a transfer. So "who works on it has nothing to do with regulation" is
also not quite right: if Shamsy is established in the EU (the brief puts the owner in Europe, working in English and
Dutch), developers in China with access to production personal data is exactly what the technical lead is asking
about. The honest, simple answer is also the reassuring one: host Supabase in an EU region on Shamsy's own account
with Supabase's data processing agreement; build and test on staging with invented or masked data; keep access to
production personal data to Shamsy's people and to the one person in Europe who needs it. Correcting this ourselves,
before he asks, is worth more than having been right on the call.

**The video is a good request to accept.** It is small, paid, and it is a showcase of our work to exactly the people
the client respects for trying. It must be safe: a narrated screen recording of the trial screen only, no code, no
repository, no live link. A live link is the real risk, because the hosted demo is connected to a database and anyone
with the link could write into it. $75 is his own figure; accept it as offered. Give him a date, since the vague
answer on the call was the one thing he visibly disliked.

**The design point is an opening, not a problem.** He said design was not the winning factor; security and "a full
system" were. Welcome the other candidate's work, ask for written permission from that candidate first, and say it
will be used as a reference for flow and layout rather than copied. Ask him meanwhile for the three or four things he
liked least in our screens; that turns "improve the design" into a list that can be finished. His own dashboard
prototype stays the base for colours and type.

**Using each step as soon as it is finished: yes, with one caution from his own brief.** Section 12 says the
spreadsheets stop at go-live and that running both side by side "is how the old books went wrong". Using an early
finance step for real before the go-live import means exactly that. The sensible line: each accepted milestone is
released to production; for each one we agree whether it is used for real or tried alongside, and the go-live import
still sets the opening balances. This also matches the terms (warranty and live-testing) already agreed.

**Group chat: fine once the contract is active, and say so plainly.** Moving communication off Upwork before a
contract breaks Upwork's rules; after the contract starts, using another tool for day-to-day messages is normal,
while payments and milestone approvals stay on Upwork. Telegram suits the team. Do not repeat the suggestion about
sharing an Upwork account: account sharing is against Upwork's terms and can get the account suspended, and it is
not something to put in writing to a client.

**Language and the team.** The client now knows the team is in China and that written communication works best. That
makes the written technical outline even more useful: it is how the team's knowledge reaches the technical lead
without the call depending on it.

#### Suggested reply (ready to send on Upwork, after the call)

Hi,

Thank you for the call. As promised, here is everything in writing, with answers from the team.

1. The video for the other candidates. Yes, we can do that, and $75 is fine. It will be a short narrated screen
recording, about four to five minutes, of the trial screen: what it does and why, prices coming from the catalogue,
the discount bands and the owner's approval, the rate floor, a saved order that never changes, and one order even
when the save is sent twice. It shows no code and no repository, and I would not share the live link, because it is
connected to a database and anyone with the link could write into it. You will have it within two working days of
your go-ahead.

2. Design. We would be glad to see the other candidate's work once he has agreed in writing, and we will use it as a
reference for flow and layout rather than copy it. In the meantime it would help a lot if you could name the three or
four things you liked least in our screens, so improving the design becomes a clear list. Your dashboard prototype
stays the base for colours and typography.

3. Meeting with your technical lead. Today or tomorrow both work; please send a time. To make the meeting useful for
him, I will send a one-page outline beforehand of how steps 1 to 9 would be built: roles and cost prices enforced by
the database, rates frozen on every order, duplicate transaction codes, the Sudan business day for the daily limit,
and how the go-live import is reconciled. He can then spend the meeting on whatever he wants to challenge.

4. Where the data lives. I want to correct something I said on the call, because it was too simple. The GDPR does not
require the servers to be in the EU. What it controls is personal data leaving the EU, and someone outside the EU
being able to see that data counts as it leaving. So the setup I would propose is: Supabase in an EU region, on
Shamsy's own paid account, with Supabase's data processing agreement in place; the team builds and tests on a staging
copy with invented or masked data; and access to live personal data stays with your people and the one person on our
side in Europe who needs it. That answers your technical lead's question properly, and I am happy to go through it
with him.

5. Using each step as soon as it is finished. Yes. Each accepted milestone goes to your live system. One thing from
your own brief is worth keeping in mind: section 12 says the spreadsheets stop at go-live, because running both side
by side is how the old books went wrong. So for each step we can agree whether you use it for real straight away or
try it alongside, and the go-live import still sets the opening balances.

6. Group chat. Happy to, once the contract is active. Telegram works well for the team. Payments and milestone
approvals stay on Upwork.

Valdis

#### Advice for the user

- **Send the written follow-up today.** He asked for answers "today", and he said on the call that writing is fine
  for him. A same-day written recap also repairs the "as soon as it will be done" moment.
- **Decide before sending:** the video fee ($75, his figure) and the delivery promise ("within two working days of
  your go-ahead"). Both are in the draft; change them if they do not suit.
- **The video can be produced here.** A scripted browser recording of the trial screen with on-screen captions can be
  made without anyone speaking; a voice-over, if wanted, can be recorded over it afterwards.
- **Prepare the technical lead meeting in writing.** The one-page outline promised in point 3 should go out before the
  meeting. On the meeting itself, avoid "I'm not aware of the project"; if a detail is not known, "I'll confirm that in
  writing today" is the better answer.
- **Do not suggest account sharing again, and do not move to Telegram before the contract.** Both are Upwork policy
  problems; the draft handles the group chat correctly.
- **The GDPR correction is deliberate.** It costs nothing to correct ourselves now; it costs the job if the technical
  lead corrects it in the meeting.

#### Delivered, 2026-09-29: the video and the technical outline

- **Video:** `../../2026-09-24/Shamsy-Order-Screen-Trial/Trial-walkthrough.mp4`, 3 minutes, 1280x720, captions, no
  sound, no code, no link shown. It walks through the brief's worked example on the live trial: adviser signs in,
  three lines (sand, red, blocked), the rate 7,900 refused and put back to 8,000, the owner approving the blocked
  line and the rates page, the order saved at $5,490 / 45,018,000 SDG, the rate staying on the order, the
  double-save point, the Arabic screen, and a closing card. Recording it created order SA-00061 and one approval in
  the trial database.
- **Technical outline:** `Technical-outline.pdf` (one A4 page, source `Technical-outline.html`), ten sections mapped
  to the brief: stack and delivery, money and history, the ledger, roles and cost visibility, transaction codes,
  daily capacity, discounts and release, phones on 3G, the go-live import, data protection.
- **Facts checked for both:** the trial's 39 tests pass (under Node 22; the 8 screen tests need Node 20.19 or later
  locally). Both demo links answer.
- **Note for the user:** the trial's owner account shows the client's own name ("Eljeli El Tayeb") on the approvals
  and rates screens, so it appears in the video he will show other candidates. It is his own trial environment, so
  that is his call; it can be re-recorded with a neutral owner name if he prefers.

**Covering message for the video (ready to send):**

Here is the video for the other candidates: a three-minute captioned walkthrough of the trial screen, using the
worked example from your brief. It shows what the screen does and why, and no code or links, so it is safe to share.

Valdis

**Covering message for the outline (ready to send, before the meeting):**

As promised, a one-page outline for your technical lead of how steps 1 to 9 would be built, mapped to your brief. He
can use the meeting to challenge any part of it.

Valdis

---

### 4. Client to Valdis (received 2026-09-29): the video shows the wrong trial

**His message (verbatim):**

> I appreciate the effort however you sent me a demo on the wrong project, that is not the winning trial that gave
> you the project
>
> That one was even less than some other work i received
>
> Could they give it with the right trial
>
> And can we already create the group?

#### Analysis

**He is right, and the mistake is ours.** The video recorded dealer-order-entry, the one-screen order task. The
work he chose is Qirsh, the full platform, on the hosted Supabase project (qirsh-live.vercel.app). He asked for that
version himself after comparing the two (`Reply-to-comparison.md`: "Say the word and I will put Qirsh on the hosted
project"), and it is the one that carries both reasons he gave on the call: security, and "thought beyond the scope,
a full system". The mistake started in section 3 of this log, which planned "a narrated screen recording of the
trial screen": his "trial tool" meant the work he judged, not the task's title.

**"That one was even less than some other work I received."** He is saying the one-screen task ranked below other
candidates' trials. Shown to those candidates as the winner, it would have embarrassed him in front of people he is
trying to treat fairly. So the reply does not defend it or explain the difference between the two. One sentence
owns the mistake, and the right video goes with it.

**The new video is built around what won.** It follows one order from the adviser to the owner and back. It then
spends its time on the two things he named:
- **Security:** the in-app page where the adviser's own session tries eight ways round the rules and the database
  refuses all eight, including approving her own pending discount.
- **The full system:** landed cost, profit, accounts, duplicate transaction codes, closing checks, rules as
  settings, and saving with no connection.

The safety rules are the same as before:
- no code, no links and no passwords;
- the sign-in page's shared password is hidden on camera;
- the recording has no address bar.

**The group: not before the contract, and say when instead.** The contract has not started; the meeting with the
technical lead and the award are still open. Upwork's terms do not allow moving the conversation to another app before
a contract, and the last message already said "once the contract is active". Keep that line, and make it concrete:
the group is created, and he gets the link, the day the contract starts. He is ready to go, so the reply ends with
that next step, not a question.

#### Suggested reply (ready to send, with `Qirsh-walkthrough.mp4` attached)

Hi,

You are right, sorry about that. I recorded the one-screen order task instead of Qirsh, the platform on the hosted
Supabase project that you chose. Here is the right one: a four-and-a-half-minute captioned walkthrough of Qirsh. It
follows one order from the adviser to the owner and back, and on the way shows the parts that made the difference:
the database refusing all eight attempts to get round the rules from an adviser's own session, landed cost, profit,
accounts, duplicate transaction codes, closing checks, and saving with no connection. It shows no code, no links and
no passwords, so it is safe to share.

On the group: I will create it the day the contract starts. Upwork does not allow moving the conversation to another
app before a contract is active, and I don't want to put either of our accounts at risk over it. As soon as the
contract is started, I will set up the Telegram group, or WhatsApp if you and Michael prefer it, and send you the link
the same day.

Valdis

#### Prep notes

- **Attach the new file, not the old one:**
  - send `../../2026-09-24/Shamsy-Order-Screen-Trial/Qirsh-walkthrough.mp4`;
  - `Trial-walkthrough.mp4` is the one he rejected.
- **Do not create the group before the contract starts,** even though he asks. The reply already says it will be
  created that day.
- **Fixed and live on qirsh-live, 2026-09-29 (commit f5dbe4a, pushed):** an adviser who typed the address of an owner
  page used to get the wrong screen, although the database refused the data correctly:
  - Profit showed an empty report;
  - Accounts, Closing checks and Settings showed a spinner that never ended.

  Those four pages now show the database's answer, "Your role (adviser) cannot do this.", which is what the hosted
  Qirsh message promised. The hosted client had also been replacing that message with a generic one; it now passes
  it through, as the in-browser demo does. The owner's view of the four pages is unchanged. Typecheck, 43 tests and
  the build pass.
- **The full live check after that fix found two more problems. Both are fixed and deployed:**
  - The warehouse's Price list spun forever. It now shows the refusal (commit 0d959b7).
  - The dealer environment's Settings page (Yasir Babiker, Dongola Power) crashed because that company has no account
    holders yet. It now opens (commit 1e456e6).
- **Final check on the live site:**
  - all six people on the sign-in list, 15 pages each, 90 in total;
  - 73 pages open normally and 17 show the database's refusal;
  - nothing hangs and there are no page errors;
  - the security page refuses every attempt for every role (adviser 8 of 8, owner, marketing and dealer owner 7 of 7,
    warehouse 6 of 6);
  - when marketing presses save on an order, the screen shows "Your role (marketing) cannot do this.".
- **The recording wrote to the hosted demo database:**
  - Hamid's approval of Amira's line;
  - SO-00118, the approved worked example for Ahmed Trading, $5,490 at 8,200;
  - SO-00119, saved with the connection off for Al Amal Trading Rabak, $3,570.
  - Earlier takes left SO-00115, SO-00116 and SO-00117. They are cancelled through the app's own "Cancel the order",
    with the reason "Duplicate made while recording the walkthrough video", so they show as Cancelled rather than as
    open orders.

#### Delivered, 2026-09-29: the corrected video

- **File:** `../../2026-09-24/Shamsy-Order-Screen-Trial/Qirsh-walkthrough.mp4`.
  - 4:29, 1280x720, 9.5 MB, H.264.
  - Captions, no sound.
  - Recorded on qirsh-live.vercel.app.
- **Order of scenes:**
  1. Title card.
  2. Sign-in, with the shared password hidden.
  3. Amira's dashboard.
  4. The worked example: sand, red, blocked, 7,900 refused, 8,200, asking the owner.
  5. "Try it against this server", run while her request is pending: 8 of 8 refused, including "Approving your own
     discount: still pending".
  6. Hamid's screens:
     - the dashboard and the approval;
     - the landed cost of S-2026-014;
     - profit;
     - accounts;
     - receipts under "Same code, two amounts";
     - closing checks;
     - settings.
  7. Back to Amira: the draft keeps the approval, and SO-00118 is saved at 45,018,000 SDG.
  8. The connection is cut:
     - the dealer is picked from the phone's copy;
     - the order is saved on the phone;
     - a reload with no connection still works;
     - once back online, SO-00119 arrives once.
  9. The Arabic preview.
  10. A closing card with the four ideas behind it.
- **Checked frame by frame:**
  - no address bar, link, key or password anywhere;
  - no caption covers a message it talks about;
  - the join between the owner's and the adviser's parts is clean.
- `Trial-walkthrough.mp4` stays in the folder as it was.

#### Outcome

- **Sent, and the client was satisfied.** The user confirmed on 2026-10-01 that the reply above went out with
  `Qirsh-walkthrough.mp4`, and that the client was happy with the video. The client's answer is not recorded here.
- **The reply's promise still stands:** the group is created, and its link sent, the day the contract starts. That
  link goes out with the section 5 reply.

---

### 5. Client to Valdis (received before the contract started; date not recorded): another candidate's design

**The client's message (verbatim).** The two demo passwords are left out of this file; they are in the Upwork
message.

> Hi
>
> Live app: https://shamsy.vercel.app
> Code repo: https://github.com/softwaredevzestgeek/shamsy
>
> Shamsy · Solar distribution · Orders
> GitHub - softwaredevzestgeek/shamsy
> Contribute to softwaredevzestgeek/shamsy development by creating an account on GitHub.
> GitHub
> Logins
> Sales adviser: adviser@shamsy.test / [password in the Upwork message]
> Owner: owner@shamsy.test / [password in the Upwork message]
>
> Please take a look at NOTES.md in the repository. It's my short note on what I'd do differently in the full system
> and a few points in your rules that I found unclear, along with the assumptions I made for each.
>
> A quick summary of what's there:-
> The worked example gives your exact numbers: $3,570 = 29,274,000 SDG, and $5,490 = 45,018,000 SDG once the owner
> approves the blocked line.
> The 5% limit is enforced by the database itself, so it holds even if someone calls the server directly.
>
> A saved order never changes. When I changed the rate setting to 9,000, the order still showed 8,200 and 45,018,000
> SDG.
> It's built for phones on weak connections. An order being entered isn't lost if the signal drops, and retrying can
> never create a duplicate order.
>
> Will send you the Loom video walkthrough shortly.
>
> https://www.loom.com/share/10f6dd304c3441a29d7b05110675a940
>
> This is one of the designs i liked. We doesnt need to make the exact same design, but so that you understand what i
> like
>
> I believe your team can create even better than that

#### Analysis

**What this is.** The first part is the other candidate's own trial submission, forwarded. It has:
- the live app, the repository and the demo logins;
- the candidate's notes;
- a Loom walkthrough.

The last three lines are the client's. This is what the client promised on the call (section 3): another
candidate's work, shared with that candidate's permission, so we can see the design the client liked. The client
asks for a design in that direction, not a copy, and expects ours to be better. Design was the one condition left
open on the call ("improve the design of the tool"). Now it has a concrete reference.

**What the reference does.** Checked on 2026-10-01 on the live app, at phone and laptop width, as both roles. I only
looked; nothing was created. Screens are saved in `client-files/reference-design/`.
1. **Navigation:** a dark green top bar with a sun mark and four tabs: Orders, New order, Approvals (with a count)
   and Settings. There are few places to go and no sidebar.
2. **Look:** a warm off-white page, white rounded cards, generous spacing, and one main action per screen in dark
   green.
3. **Order entry in three numbered steps:** dealer, products, exchange rate. Dealers are cards with initials.
   Products are tiles with the price and a "+", added with one tap.
4. **The total is always in view:**
   - a dark green "Dealer pays" panel beside the form on a laptop;
   - a sticky bar on a phone with the pounds total and the Save button;
   - "Draft kept on this device" shown under it.
5. **Orders list:**
   - three tiles: orders, awaiting approval, confirmed value;
   - filter chips with counts;
   - order cards with a coloured edge and a status pill;
   - a floating "+" for a new order on phones.
6. **Approvals as cards:** the percentage in a red badge, then line value, discount and line total, then one large
   Approve button.
7. **The discount bands** carry a colour, an icon and a word (sand, red, blocked), not colour alone.
8. **Finish:** skeleton loading, short entrance animations, and a sign-in page with a dark green panel and one
   sentence about what the system does.

**What the client likes is mostly structure and calm, not colours.** The reference's green and sun yellow are close
to the client's own prototype: `--green: #0E3B2E` and `--gold: #C9922E` in `shamsy-dashboard-v2.html`. What differs
from a full system like Qirsh:
- one job per screen;
- large touch targets;
- the money that matters always visible;
- a guided order flow.

The task is to keep Qirsh's breadth, all nine steps, and give every screen that focus.

**Their notes.** The technical ideas mostly match ours: a ledger, rate history, multi-tenant from day one, cost
prices out of reach, an offline outbox, an audit trail. Three of their rule questions are worth raising as business
questions when the milestone 2 acceptance tests are agreed with Michael:
- whether an approval given days later should still use the old rate;
- which price the bands are measured against after an owner overrides a price;
- whether a pending request reserves stock.

**Boundaries.**
- Use the reference for direction only. Do not copy its code, text or assets.
- Do not use or share its logins beyond looking.
- The Loom video was not watched here; the live screens were checked directly.

#### Suggested reply (ready to send)

Hi,

Thank you for sending this, and for asking the other candidate first. I went through it on a phone and on a laptop,
and I can see what you like: a few screens with one clear job each, the order entered in three numbered steps,
products added with one tap, the amount the dealer pays always in view, approvals as cards with one big button, and
the discount bands shown with a colour, an icon and a word.

That is the direction we will take. Your own prototype stays the base for colours and type, and it is already close
to this: the dark green and the gold. The first milestone sets the design: the layout, colours and type, shown on the
order screen, the orders list, approvals and settings, on a phone first. You will see those screens on the staging
link and approve them before the rest is built on them, so the design is settled at the start rather than fixed at
the end.

As promised, here is the group for day-to-day messages: [group link]. Payments and milestone approvals stay on
Upwork.

Valdis

#### Prep notes

- **The group link.** Create the group first (Telegram, or WhatsApp if the client and Michael prefer it) and put
  its link in place of `[group link]`. It was promised for the day the contract starts, which is today.
- **No question at the end,** because the contract has started. The design check is stated as a step: screens on
  staging for approval.
- **Milestone 1.**
  - The design tokens come from the client's prototype.
  - The patterns come from the list above.
  - Show the four screens on the client's staging deployment, not on our demo projects.
- **Keep the reference private.** Its screens are in `client-files/reference-design/`, outside the repository. Never
  copy its code.

#### Outcome

- **The group exists, and the conversation is going on there.** The user confirmed on 2026-10-01 that the group was
  created and that they are chatting with the client in it. The promise made in section 4 is kept.
- **Not confirmed:** whether the design part of the reply above (the direction, and the four screens on staging for
  approval) was sent as written. Check before repeating or contradicting it.

---

### 6. The contract started (2026-10-01)

No client message is recorded for this. The user reported that the project is confirmed and work starts today. The
project moved to `/home/ph/Client/Upwork-project/Shamsy-Qirsh-Platform/`, and the copies under `Upwork-ritvia` are
frozen.

Open from earlier sections:
- ~~the group chat promised for the start day (section 4)~~ (settled: created on 2026-10-01, and the conversation
  is going on there; see section 5, "Outcome");
- ~~whether the section 4 reply and `Qirsh-walkthrough.mp4` were sent~~ (settled: sent, and the client was
  satisfied; see section 4, "Outcome");
- the design notes and the other candidate's design (section 3);
- the confidentiality agreement before any real data;
- the hosting set-up in an EU region on Shamsy's own account.

See `HANDOFF.md`, "Promised, and due now".

---

### 7. Valdis to the client (draft, 2026-10-01): the milestone plan

No client message. The user asked for the US$4,000 to be split into milestones, because it had not been divided
yet.

#### How the split was made

- **One milestone per step of the brief,** because the brief says "Each step is a milestone and usable on its own".
  Go-live is a tenth milestone.
- **Hours were estimated per step**, about 306 in total, the figure the client quoted back on 2026-09-28. The
  estimate reflects how much each step involves in the brief and how much Qirsh already covers.
- **Amounts follow the hours**, at about US$13.07 an hour, rounded to US$50. They add up to exactly US$4,000.
- **Milestone 1 carries the design,** the condition the client set on the call.
- **Go-live is US$350 (8.75%).** It is the payment held back for two weeks of live testing, so it stays small, as
  the section 2 prep notes advised.
- **Check before sending.** If the breakdown sent on Upwork before 2026-09-28 gave hours per step, compare them with
  the table in `HANDOFF.md`. If they differ, use the figures already sent, so the client sees the same numbers twice.

#### Suggested message (ready to send)

Hi,

Here is how I would split the $4,000 into milestones. Each step of your brief is one milestone, so each one is
usable on its own as your brief describes, and Michael reviews one pull request per milestone.

1. Platform setup, including the design: $600
2. Orders: $400
3. Receipts, with proof and status: $450
4. Accounts, limits and movements: $450
5. Release against paid orders: $150
6. Purchasing, landed cost and stock: $500
7. Margin, profit and checks: $450
8. Quotes and price lists: $350
9. CRM: $300
10. Go-live: the import and reconciliation, deployment, and the two weeks of live testing: $350

Total: $4,000.

Before each milestone starts, Michael and I agree its acceptance tests in writing, and I give you its target date.
When your architecture document arrives next week, I will check this plan against it. The steps and the $4,000 stay
as they are. If the architecture moves work from one step to another, I adjust the split before those milestones
start, and anything in it that goes beyond the brief we look at together before it is built.

I will set these milestones up in the contract now. As soon as milestone 1 is funded, I start on the design and the
first screens on staging for your approval, and the technical setup follows your architecture once it is here.

Valdis

#### Prep notes

- **On Upwork:**
  - propose the ten milestones in the contract, with these names and amounts;
  - the client funds them one at a time;
  - if the contract was created as a single US$4,000 milestone, the client can change it into these ten.
- **The architecture document** is expected around Tuesday 2026-10-06. Until it arrives, start with the work it
  cannot change: the design, the screens and the gap review against the brief. Hold the repository structure,
  sign-in and hosting set-up until then.
- **Dates.** No dates are promised here. Each milestone gets a target date when its acceptance tests are agreed, so
  the client hears a date rather than "as soon as it is done", but only once the user has confirmed the hours they
  can give each week.

#### Status

- **Held, not sent (2026-10-01).** The user confirmed the plan has not been given to the client. It goes out when the
  client raises milestones, payment or dates, adapted to what the client asks.
- **Keep as they are:** the ten milestones, their names and amounts, and the US$4,000 total. If the client wants a
  different split, draft it and hold it for the user.
- **Adapt before sending:**
  - Answer the client's question first, then give the plan.
  - "When your architecture document arrives next week": change it to where things stand that day. If the document
    has arrived and moves work between steps, adjust the split only with the user's agreement.
  - "I will set these milestones up in the contract now": milestones live on Upwork, and from 2026-10-01 to about
    2026-10-11 the user's Upwork account is not in use. In that period, ask the client to add the milestones to the
    contract as listed, or say they will be set up on Upwork shortly.
  - If the design message (section 8) has not gone out either, the milestone 1 line can carry its short version: the
    first look on a phone, then the four screens on staging for approval.
  - Still no dates per milestone until the user has confirmed their weekly hours.

---

### 8. Valdis to the client (draft, 2026-10-01, for the group): the design message

No client message. The user asked for the design message to be written again, for the group chat, so that the
client feels sure about the design. It replaces the design part of the section 5 reply, which may not have gone out.

#### Analysis

**What the client is worried about.** Design is the one thing the client has criticised, twice:
- on 2026-09-29, "based on design the work of your team wasnt the best" (section 3);
- with the reference, "I believe your team can create even better than that" (section 5).

On the call the client also disliked "it will be done as soon as it will be done". So the client needs three things:
proof that we saw the weakness, proof that we understood what they like, and a date to look forward to.

**What the message does.**
- **Owns the weak point in one sentence**, with the honest reason: Qirsh's screens were built to prove the system
  (security, the money rules, all nine steps), and the design now gets the same attention, first.
- **Shows the understanding with specifics**, the seven patterns from the reference, so the client sees they were
  read closely.
- **Treats the reference as the bar to beat, not to copy.** This answers "even better than that", and tells the
  client the other candidate's work is respected.
- **Keeps the client's own brand:** the green and gold of their prototype.
- **Goes beyond the reference where it matters for a full system.** The reference is a few screens. Ours is one set
  of colours, type, buttons and cards used by every later screen, so receipts, stock, profit, quotes and CRM look like
  the first screens.
- **Gives a date and an approval step.** The first look comes by a stated date. The four screens are then shown as
  working screens on staging, and nothing is built on the design until the client approves it.
- **Makes feedback easy:** a few words or a screenshot with a circle on it.

**Left out on purpose.** No question at the end (the contract has started), no price, and no promise of unlimited
redesigns. Changes asked for in the approval round are part of milestone 1, as the terms already say.

#### Suggested message (ready to send in the group)

Hi,

About the design, so you know exactly what to expect.

You were right that design was not the strong part of our screens. They were built to prove the system: the
security, the money rules and all nine steps. Now the design gets the same attention, and it comes first, before
anything else is built. We take the design you shared as the bar to beat, not something to copy.

What you will get:
1. Your own prototype's dark green and gold, in the calm and clear direction you liked: one job per screen, the order
in three numbered steps, products added with one tap, the dealer's total always in view, approvals as cards with one
big button, and the discount bands shown with a colour, an icon and a word.
2. Made for the phone first: large buttons, clear amounts in dollars and pounds, and quick on a weak connection.
3. One set of colours, type, buttons and cards for the whole system. Receipts, stock, profit, quotes and the CRM will
look and feel like the first screens, not only the first four.

How you approve it:
By Thursday 8 October you will see the order screen and the orders list on a phone, as screenshots and a short
video. Then approvals and settings follow, and all four go on the staging link as working screens you can click
through yourself. Tell me anything you don't like, in a few words or a screenshot with a circle on it, and we change
it at that point. Nothing else is built on the design until you have approved it.

Valdis

#### Prep notes

- **The date is a promise.** "By Thursday 8 October" is five working days from Friday 2026-10-02, and assumes the
  design work starts now. If the user wants to wait until milestone 1 is funded, write "within five working days of
  milestone 1 being funded" instead. Change the date if the user's week does not allow it.
- **What the first look is.** The order screen and the orders list, built in the Qirsh code with the new design, shown
  on a phone width (390 px). Send them as screenshots plus a short captioned screen recording, with no address bar,
  links or passwords, and invented data only.
- **Staging needs the client's accounts:** Vercel and an EU Supabase project, from the week 1 list in `HANDOFF.md`.
  The message gives no date for the staging link for that reason. Never use our demo deployments for this.
- **Scope.** Design changes asked for in the approval round are part of milestone 1. A whole new direction after the
  four screens are approved is a change, to be named and agreed separately.
- **Video rules:** captioned screen recording, or a neutral text-to-speech voice; the user does not appear on camera.

#### Status

- **Held, not sent (2026-10-01).** The user saved the message to use when the client asks about the design.
- **When that question comes:** adapt the message to what the client asks, rather than sending it as it stands.
  - Answer the question first.
  - Keep the promises: the client's green and gold, phone first, one design for every screen, approval before
    anything is built on it.
  - Set the first-look date from that day; five working days is the base. "Thursday 8 October" holds only if it is
    sent by 2026-10-02.
