# Putting Qirsh on a hosted Supabase project

The demo runs Postgres in the browser tab so anyone can click through it without an account. This
file is the other half: the same application, the same migrations, on a Supabase project, with
Supabase Auth deciding who you are and every policy enforced by the server.

Nothing in `supabase/local/` is used here. That folder exists only so the browser demo can pretend
to be Supabase: an `auth` schema, an `auth.uid()`, a clock it can move, and a sign-in that needs no
password. A hosted project has all of those for real.

## What changes in the code

`apps/web/src/lib/hosted.ts` sends the same `rpc()` calls to Supabase instead of to the tab, and
`db.tsx` picks it when `NEXT_PUBLIC_SUPABASE_URL` is set. The screens, the rules, the migrations and
the money code are untouched.

Three things exist only because the server is now somewhere else:

- **Proof photos go to Storage.** In the demo the screenshot stays in the tab. Here it is uploaded
  to the private `proofs` bucket as `<tenant>/<receipt>.jpg`, which is exactly the string the
  receipt stores, because the read policy compares the two. A photo that cannot be uploaded stays on
  the phone and goes up with the outbox.
- **The app itself is kept on the phone** (`apps/web/public/sw.js`). Without it, a phone that loses
  the connection and then reloads gets nothing back, because the screens come from the network. Only
  GET requests for the site are served this way; every save goes straight to the server.
- **The last answer the server gave is kept too** (`apps/web/src/lib/lastseen.ts`), so a reload in a
  dead spot comes back with the customers and the price list rather than empty screens. The app says
  the lists are the last loaded ones instead of passing them off as current, and sign-out clears
  them.

## Three files to run, in this order

In the Supabase SQL editor:

| Order | File | What it does |
| --- | --- | --- |
| 1 | `supabase/hosted-install.sql` | The nine migrations and the storage policies, in one paste |
| 2 | `supabase/hosted-users.sql` | The six people as real sign-ins, with the ids the data uses. Password `qirsh-demo` |
| 3 | `supabase/hosted-seed.sql` | About a hundred days of business: 6,471 rows across 32 tables |

Both generated files are rebuilt with:

```bash
npx tsx scripts/build-hosted-install.mts
npx tsx scripts/export-hosted-seed.mts
```

The seed is not invented at export time. It is produced by replaying the business through the
database's own functions, in this process, against the same migrations, and then written out as the
rows those functions produced. The export skips columns the database fills itself and writes tables
parents first, so the file needs no special privileges and no disabled constraints.

## Where it runs

https://9-26-test-demo.vercel.app - this repository on Vercel against a hosted Supabase project.
The sign-ins are listed on the page; the password for all of them is `qirsh-demo`.

## Then the application

```
NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
```

Deploy `apps/web` (Nx monorepo: set the Vercel root directory to `apps/web`). Without those two
variables the same build runs the in-browser demo, which is useful for showing the system to
someone who should not have a login.

## Proving it on the server

The demo's 28 checks build a fresh database from the migrations and attack it; on a hosted project
there is one database and you are signed in to it. `/server-checks` does what a curious person with
the anon key and a login would do, over the same REST interface the screens use: read another
tenant's orders, read the cost tables, insert an order straight into the table, change the rate on a
saved one, approve your own discount, call a private helper. Every row that passes is the database
refusing something.

## The offline queue

It matters more here than in the demo. A save that cannot reach the server waits in the phone's
outbox and goes again when the connection returns; every write carries an id made on the phone, and
`save_order` treats a repeat of that id as the same order. The queue also catches a request that
leaves but never arrives, which is the common case on a weak connection rather than a clean offline
switch. Photos waiting to be uploaded are sent in the same pass.

What that adds up to, with the connection off: the screen you are on keeps working, a reload brings
the app and the lists back as they were, and what you save waits on the phone. What it does not do
is invent server answers: an address this phone never opened while it had a connection says so
rather than showing another screen in its place.
