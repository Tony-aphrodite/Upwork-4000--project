# Shamsy platform (built from Qirsh): handoff

Written 2026-10-01, when the project moved here from the bidding workspace. Two folders there are now frozen:

- `/home/ph/Client/Upwork-ritvia/2026-09-23/Trelvane-Agency-Platform/`: the bid, the original chat log and the
  client's files.
- `/home/ph/Client/Upwork-ritvia/2026-09-24/Shamsy-Order-Screen-Trial/`: the trial task, the original Qirsh
  repository and the videos.

Those two folders exist on the user's machine only.

**The repository, since 2026-10-02:** `https://github.com/Tony-aphrodite/Upwork-4000--project`, **private**.
- It must stay private, because it holds the client's confidential brief, files and messages.
- The friend works from a clone of it.
- `qirsh/` came in with its full history from the demo repository.
- The user's original folder (`/home/ph/Client/Upwork-project/Shamsy-Qirsh-Platform/`) was left as it was. When
  the user is back, continue from a fresh clone of this repository, which then has the friend's work.

A new session should read this file, then the last sections of `chatting.md`, and carry on from "Next steps" below.
Last updated 2026-10-02, when the project went into its private repository for the handover.

## 2026-10-01 to about 2026-10-11: the user's friend runs the project

The user handed the project to a friend for ten days. Help the friend as you would help the user: same rules, same
files. The friend is new to the project, so explain a little more, and name the section of this file or of
`chatting.md` that each answer rests on. Reply in Korean, as for the user; if the friend writes in another language,
reply in that one.

**How a day works.**
- **A client message** (from the group or from Upwork): add the next numbered section to `chatting.md`, with the
  message verbatim, an analysis, a reply ready to send (signed Valdis) and prep notes. Then give a short summary with
  the reply in a code block.
- **A design question from the client:** the design message is held, not sent, in `chatting.md` section 8. Adapt it
  to what the client asks, keep its promises (the client's green and gold, phone first, one design for every screen,
  approval before anything is built on it), and set the first-look date from that day: five working days is the
  base.
- **Milestones, payment or dates come up:** the milestone plan is held, not sent, in `chatting.md` section 7. Send
  it then, adapted as its "Status" says. The ten names and amounts stay as they are; a change to the split is for
  the user.
- **Code work:** see "Next steps" and "The code" below.
- **Log every session in `WORKLOG.md`**, with "(friend)" in the row.

**What stays with the user.**
- **The Upwork account.** Its login is not handed over: account sharing is against Upwork's terms and can get the
  account suspended. Upwork actions (milestones, payments, messages on Upwork) wait for the user. Day-to-day talk with
  the client happens in the group.
- **Money and scope.** Any price, any change to the US$4,000 or to the scope: draft it and hold it for the user.

**What the friend decides.** Replies in the group within what is already agreed, the design work, and local
commits. A push still needs explicit approval each time; during these ten days the friend gives it.

**Due in these ten days.** The work list is §8 of `SCOPE-REVIEW.md` (written 2026-10-01). Read its summary first.
1. **The week 1 request,** ready to send in `SCOPE-REVIEW.md` §7: the EU Supabase project, Vercel, the GitHub
   repository, the confidentiality agreement and the files.
2. **The design:** the first look (order screen and orders list on a phone), then approvals and settings. Commit it
   in this private repository. Never put Shamsy branding in our demo repository or demo deployments.
3. **Milestone 1's specification and acceptance tests,** drafted for Michael from `SCOPE-REVIEW.md` §2 and §3.
4. **The architecture document,** around Tuesday 2026-10-06. Compare it row by row with `SCOPE-REVIEW.md` §5.
5. **The early questions** in `SCOPE-REVIEW.md` §6 (1 to 6), above all the August margin figures, which do not
   reconcile as the brief states them.
6. **Ask the user:** whether the section 2 terms were sent as drafted. (The milestone plan was not sent: see
   section 7.)

When the user is back, add a short summary of what changed in these ten days at the top of this section.

## Status

- **2026-10-01: the contract started.** The user reported that the project is confirmed and work starts today. No
  client message about the start is recorded yet.
- **Price: US$4,000 in total, fixed, for steps 1 to 9 of the brief.** The user confirmed on 2026-10-01 that the
  contract was signed at US$4,000. The estimate is about 306 hours (roughly US$13 an hour), and the client will not
  negotiate further (`chatting.md` section 2).
- **Terms, as drafted in the section 2 reply.** Confirm with the user that it was sent as written.
  - **Scope:** the final brief, steps 1 to 9, the section 12 import and go-live, and the section 13 acceptance tests.
    Before each milestone starts, its acceptance tests are agreed in writing with the technical lead. Anything in
    those specs beyond the brief is a scope change, discussed and approved separately.
  - **The import:** I import and reconcile. Old records that break the rules go to the open-questions list for the
    owner to decide.
  - **Payment:** each milestone is held in escrow and released after delivery and the technical lead's approval of
    the pull request.
  - **Review:** against the agreed acceptance tests and the brief's standards (TypeScript, tests with every change,
    reviewed pull requests, GitHub Actions green, documentation with the feature). Comments come back in one round
    within about five working days, and in-scope fixes are part of the milestone.
  - **Warranty:** each milestone is covered from the day it is accepted until 60 days after the final go-live. It
    excludes new features, changes made by others, Supabase or Vercel outages, and figures already wrong in the
    source spreadsheets. A reported defect gets a reply within one working day.
  - **Go-live:** two weeks of live testing from the go-live date; the final payment follows once material defects
    are fixed. Go-live is scheduled after the owner confirms the opening balances and answers the open questions.
- **Milestones: ten, one per step of the brief, plus go-live.** Drafted on 2026-10-01 and not yet agreed with the
  client; the proposal is `chatting.md` section 7. The user confirmed on 2026-10-01 that it has not been sent: it goes
  out, adapted, when the client raises milestones, payment or dates.
  - Hours are estimated per step from the brief and from what Qirsh already covers.
  - The amounts are proportional to the hours, at about US$13.07 an hour, rounded to US$50.
  - Go-live is 8.75% of the price. It is the payment held for two weeks of live testing, so it is kept small.
  - **Why ten milestones, not nine.** The brief has nine steps, and go-live is its own milestone for three reasons:
    - the client called it "the final go-live milestone" in the 2026-09-28 terms, and said the price includes "the
      final go-live/import";
    - the section 12 import and the production deployment belong to no single step;
    - kept separate, only US$350 is held through the two weeks of live testing, and step 9 (CRM) is paid when it is
      accepted.

    If the user wants nine, merge step 9 and go-live into "CRM and go-live, US$650". All of that would then be held
    for the two weeks.

| # | Milestone | What it delivers | Hours | US$ |
| --- | --- | --- | --- | --- |
| 1 | Platform setup, with the design | Logins with password reset, four roles in RLS, products and customers, account holders, settings per environment, the design (layout, colours, type) on the order screen, orders list, approvals and settings; the repository, CI and staging on the client's accounts in an EU region | 44 | 600 |
| 2 | Orders | Fixed prices with the owner override, minimum rate, discount bands and line approvals, frozen rates, payment instructions | 30 | 400 |
| 3 | Receipts, with proof and status | One line per transaction code with the proof photo, receipts across orders, duplicates refused and flagged, statuses | 34 | 450 |
| 4 | Accounts, limits and movements | Live balances from the ledger, the daily limit warning, transfers, payouts, cash, pass-through accounts | 34 | 450 |
| 5 | Release against paid orders | The warehouse releases only fully paid orders | 12 | 150 |
| 6 | Purchasing, landed cost and stock | Invoices, costs in four currencies, the 20% uplift, stock and transit, kits, own-brand model codes | 40 | 500 |
| 7 | Margin, profit and checks | Results by product, order, customer, adviser, shipment, week and month in USD and EUR, currency result, closing checks | 36 | 450 |
| 8 | Quotes and price lists | House-style PDFs, WhatsApp share, statuses, quote to order, made-to-order items | 26 | 350 |
| 9 | CRM | Dealer profiles, segments, pipeline, source, revenue per dealer, share of wallet | 22 | 300 |
| 10 | Go-live | The section 12 import with reconciliation, deployment, and the two weeks of live testing before the final payment | 28 | 350 |
| | **Total** | | **306** | **4,000** |
- **People:**
  - the client is Shamsy's owner;
  - the technical lead is **Michael**, who reviews the delivery scope and approves every pull request.
- **What won the job, in the client's words:** security, and "thought beyond the scope, a full system". The client
  said the design was not the best, and wants it improved.

## Promised, and due now

1. **Done: the group chat.** The user confirmed on 2026-10-01 that the group was created and that the conversation
   with the client is going on there. Log messages from the group in `chatting.md` like Upwork messages, saying
   where each came from. Payments and milestone approvals stay on Upwork.
2. **Done: the section 4 reply with `deliverables/Qirsh-walkthrough.mp4`.** The user confirmed on 2026-10-01 that it
   was sent and that the client was satisfied with it. `Trial-walkthrough.mp4` is the video the client rejected.
   - **Videos from now on:** the user does not appear on camera. Make captioned screen recordings, or use a neutral
     text-to-speech narration. Never animate a real person's face or imitate a real person's voice.
3. **Design.**
   - **Received: another candidate's trial as the design reference** (`chatting.md` section 5). The client likes
     its direction and expects ours to be better:
     - a dark green tab bar;
     - one job per screen;
     - order entry in three numbered steps;
     - products added with one tap;
     - the dealer's total always in view;
     - approvals as cards with one big button;
     - bands shown with a colour, an icon and a word.
   - Screens are saved in `client-files/reference-design/`. Use them for direction only, never copy them.
   - The client's prototype (`client-files/shamsy-dashboard-v2.html`, green `#0E3B2E` and gold `#C9922E`) stays the
     base for colours and type.
   - Milestone 1 sets the design. The order screen, orders list, approvals and settings go on staging, on a phone
     first, for the client's approval before the rest is built on them.
4. **Hosting and personal data** (section 3, as corrected in writing):
   - Supabase in an EU region, on Shamsy's own paid account, with Supabase's data processing agreement;
   - staging with invented or masked data;
   - access to live personal data limited to Shamsy's people and the one person on our side in Europe who needs it.
5. **The confidentiality agreement comes before any real data.** The brief says data is shared only after one is
   signed, and the go-live import needs Shamsy's spreadsheets.

## Expected from the client

- **The architecture document, around Tuesday 2026-10-06.** The client is writing it, probably with Michael. When it
  arrives:
  - compare it with the brief, the milestone table above and the Qirsh code;
  - keep the ten steps and the US$4,000;
  - move amounts between milestones only if the architecture moves work between steps;
  - raise anything beyond the brief as a change before it is built;
  - raise early any choice that conflicts with the Qirsh base (stack, repository layout, sign-in, hosting), because
    at a fixed price, rework is unpaid.
- **Until then:** do the design, the screens and the gap review, and hold the repository structure, sign-in and
  hosting set-up.

## Messages ready to send (as of 2026-10-01)

The user (or, until about 2026-10-11, the friend) sends client messages, mostly in the group now. Ask which of these
went out before writing the next reply. Both held messages are sent only when the client raises their topic, and are
adapted to what the client asks.

| Section | What | Before sending |
| --- | --- | --- |
| 5 | Thanks for the design reference; the design direction | Replaced by section 8. The group link part is done (group created 2026-10-01) |
| 7 | The ten-milestone plan | Held, not sent (2026-10-01). Use it when the client raises milestones, payment or dates; see its "Status" for what to adapt |
| 8 | The design message: what the client gets, the first look on a phone, approval before anything is built on it | Held, not sent (2026-10-01). Use it when the client asks about the design; set the date from that day |
| `SCOPE-REVIEW.md` §7 | The week 1 request: accounts, the confidentiality agreement, the files, users, brand assets, settings | A request, not a reply, so it can go out now. Check Supabase's current terms for point-in-time recovery first |

## Waiting on the user

- **The per-step hours in the earlier breakdown,** if it had them. The client quoted "about 306 hours" from it. If
  its hours per step differ from the milestone table, use the figures already sent.
- **Hours available each week,** to turn the milestones into target dates.
- **Whether the section 2 terms went out as drafted.**

## Next steps

1. **First, in order:**
   - ~~send the group link~~ (done: the group is running);
   - the milestone plan (section 7) and the design message (section 8) are held: send each, adapted, when the
     client raises its topic;
   - ask for what week 1 needs (list below).
2. **Week 1:**
   - review Qirsh against steps 1 to 9 of the brief, using the "To verify" column below;
   - write milestone 1's spec and acceptance tests and agree them with Michael;
   - set up the repository in the client's organisation, with CI.
3. **Then one milestone at a time.** Each one is a pull request that Michael approves, released to the live system
   once accepted.

### What to ask the client for in week 1

The ready-to-send version is `SCOPE-REVIEW.md` §7.

- A Supabase project in an EU region on Shamsy's account, with access for us.
- Shamsy's Vercel team, or wherever they want it hosted.
- A GitHub repository in Shamsy's organisation, with Michael as reviewer and the Actions secrets
  (`SUPABASE_PROJECT_ID` and an access token).
- The confidentiality agreement.
- The real users: names, email addresses and roles.
- Logo and house style.
- Confirmation of the settings: the 3% and 5% thresholds and the minimum rate.
- Confirmation that the interface ships in English first.

## Scope: steps 1 to 9 against what Qirsh already does

Qirsh was built as the bid prototype to cover the hard parts of all nine steps (see `qirsh/README.md`). It runs on
invented data. The "To verify" column lists what the brief asks for that this handoff could not confirm in the code.

| Step | The brief (`client-files/Shamsy_Project_Brief_final.txt`) | In Qirsh | To verify, or still to build |
| --- | --- | --- | --- |
| 1. Platform setup | Personal email and password logins with reset; four roles enforced by RLS; products and customers; account holders with every spelling; settings per environment; English | Four roles in Postgres, tenants, account holders, configurable settings and account kinds; Supabase Auth on the hosted version | Password reset and inviting users; sessions surviving a weak connection |
| 2. Orders | Fixed dollar prices with an owner override; minimum rate; discount bands with owner approval above 5%; payment instructions in 3,000,000 transfers | Built, including the frozen rate and per-line approvals | Agree acceptance tests |
| 3. Receipts | One line per transaction code with a proof photo; one receipt across several orders; duplicates refused, same code with another amount flagged; status | Built, with photos in private Storage on the hosted version | Agree acceptance tests |
| 4. Accounts, limits, movements | Live balances, daily limit of 15,000,000 with a warning, transfers, payouts in euros, cash, pass-through accounts at zero | Built on a ledger | Agree acceptance tests |
| 5. Release | Release only fully paid orders | Built: pick list without amounts, oldest lot first | |
| 6. Purchasing, landed cost, stock | Cost factor, invoices, costs in four currencies, 20% uplift ($270 to $303.58), stock, minimum levels, transit | Built | Kits sold as one product; own-brand model codes (SP, SWF) |
| 7. Margin, profit, checks | Results by product, order, customer, adviser, shipment, week and month, in USD and EUR; currency result per route; closing checks | Built, with 12 closing checks and month closing | The weekly overview |
| 8. Quotes and price lists | House-style PDFs, WhatsApp share, statuses, one click to an order, made-to-order items against a deposit | Built: PDFs, share, quote to order | Made-to-order items against a deposit; quote statuses |
| 9. CRM | Dealer profiles, segments A+ to D, pipeline, source, revenue per dealer, share of wallet, what each dealer still holds from our last delivery | Segments, pipeline, source, notes, revenue per dealer | Share of wallet; stock still held from our last delivery |
| Section 12 | Go-live import with a reconciliation | Not built; the approach is in `qirsh/NOTES.md` | Import functions with a dry run and a reconciliation report |
| Section 13 | Acceptance tests | 28 acceptance checks and 43 tests | Map them to the brief's tests |

## The code

- **Layout:** `qirsh/` is an Nx workspace:
  - `apps/web`: Next.js 16, TypeScript and Tailwind 4;
  - `libs/money`: the money rules;
  - `libs/db`: the PGlite and Supabase adapters, the seed and the checks;
  - `supabase/migrations`: nine migrations, the source of truth;
  - `supabase/production`: storage;
  - `supabase/local`: demo-only shims;
  - `.github/workflows`: CI.
- **Read first:** `qirsh/README.md` (what is built, how money is stored, permissions), `qirsh/NOTES.md` (decisions
  and open questions for the technical lead) and `qirsh/HOSTING.md` (the hosted Supabase set-up).
- **Run it:**
  - Use Node 22. On the user's machine: `export PATH=$HOME/.local/node22/bin:$PATH`. Then `npm ci` in `qirsh/`.
  - `npm run dev` serves on port 4331; `npm test` runs 43 tests (money 11, db 32); `npm run ci` runs everything.
  - The build uses webpack. Turbopack breaks PGlite.
  - Checked from this folder on 2026-10-01: typecheck and all 43 tests pass.
- **Our demo repository and deployments.** These are not the client's.
  - The GitHub repository is `Tony-aphrodite/9-26-test-demo`.
  - The Vercel project is `9-26-test-demo` (team servi-tec). It serves https://qirsh-live.vercel.app, which runs on
    our own demo Supabase project.
  - https://qirsh-demo.vercel.app is the in-browser version.
  - Do not put the client's code changes or data there. Production goes to Shamsy's accounts.
  - The Qirsh code now lives in this private repository. Never push from it to the demo repository.
- **Demo Supabase credentials:** `.secrets/demo-supabase.env` (the PG variables, `SUPA_URL` and `SUPA_ANON`) is for
  our demo project only.
  - Never print it, commit it or send it anywhere.
  - The user runs destructive statements on hosted databases themselves.
- **The production repository.** Start it in the client's organisation from this code. Remove the demo-only parts as
  you go:
  - the invented seed and the replay clock;
  - `supabase/local`;
  - the pick-a-person sign-in.

  Keep the acceptance checks as tests.
- **References left in the old workspace:**
  - the one-screen trial (https://dealer-order-entry.vercel.app, code in
    `Upwork-ritvia/2026-09-24/Shamsy-Order-Screen-Trial/demo`);
  - the Trelvane bid demo (https://trelvane-platform.vercel.app).

## Files here

| Path | What it is |
| --- | --- |
| `README.md` | How to start from a clone, and how to run the code |
| `chatting.md` | The client log. In the repository it is a file at the root. In the user's original folder it is a link to `qirsh/project-notes/chatting.md` |
| `client-files/` | The confidential brief (PDF and text) and the client's dashboard prototype |
| `deliverables/` | Both walkthrough videos and the one-page technical outline sent before the technical lead meeting |
| `history/` | The bid proposal and deck, and the messages sent during the trial |
| `.secrets/` | The demo Supabase credentials, readable by the owner only. On the user's machine only, never in the repository |
| `WORKLOG.md` | Sessions and hours against the 306-hour budget |
| `SCOPE-REVIEW.md` | The brief against the Qirsh code and the milestone plan (2026-10-01): gaps and hours per step, acceptance-test risks, the data model for the architecture document, questions, the week 1 request, the friend's work list |
