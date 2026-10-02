Hello,

The trial task is done. Here is everything you asked for.

1. The working screen: https://dealer-order-entry.vercel.app
   Sign in as adviser@shamsy.test or owner@shamsy.test, password qweqwe@123. It is on my own Vercel and Supabase.

2. The repository: https://github.com/Tony-aphrodite/9-24-Shamsy-trial-demo
   It is private because it carries your product names and prices. Send me the GitHub account you want added and I
   will invite it straight away.

3. The recording: [link], five minutes, walking your worked example in your order.

4. The note: NOTES.md in the repository.

Two things worth saying here rather than leaving in the note. Every rule lives in Postgres, not in the browser: the
five per cent block is a trigger that matches a line to an approval the owner granted for that exact line and
consumes it once, so calling the API directly with the anon key is refused the same way the screen is. And the
bands are compared as integers rather than as percentages, because your wording puts exactly three per cent in sand
and exactly five in red, and a percentage in floating point does not land on those boundaries reliably.

Your example reproduces exactly: 1.94, 4.32 and 7.25 per cent in the three bands, $3,570 and 29,274,000 without the
blocked line, $5,490 and 45,018,000 once the owner approves it, and the saved order still reads 8,200 after the rate
setting moves to 9,000. There are 32 tests over this, sixteen of them against a real Postgres running the same
migration the deployment uses.

Two additions you did not ask for. The owner has a small rates screen, because your rate test otherwise needs a SQL
editor, and the interface has an Arabic switch. Arabic is not required for the trial, but your non-functional
requirements ask for no hard-coded strings and a layout that can be mirrored, and one switch is the shortest way to
show that adding it later is translation work rather than a rebuild.

The note answers your six questions in section 17 and lists the places where your rules need one more decision,
including how the pound total is rounded, what happens to the second screenshot when the same transaction code
arrives with a different amount, and whether a blocked line should be saved as a draft rather than held back.

Valdis
