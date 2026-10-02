You are right on both counts, and one of them was a real defect rather than a difference in scope.

Sending the same order twice created two orders. There was no idempotency in that screen. Each attempt now carries
a token, the order is written against it, and a repeat call returns the order that already exists instead of
writing another one. It is a unique index on the adviser and the token, so it holds whether the second call comes
from a double tap, a retry after a timeout, or two requests arriving at the same moment, and there are three tests
over it including two advisers using the same token. It is live on https://dealer-order-entry.vercel.app now: I
sent the same save three times at once against the hosted project and all three came back as one order, then sent
it again a second later and got the same order, then placed a genuinely new one and got a second order. The first version said "sending twice is safe" because it did
this; the trial screen should have done it too.

On the error codes: "errorGeneric" is what crosses the wire, and on screen Sana saw a sentence rather than the
code, but you are right that one generic bucket is not good enough for a phone in Dongola. Errors now say what
happened, whether anything was written, and what to do: the rate is below the minimum the owner set; a price
changed while you were typing, so nothing was saved, reload and add the line again; a line is above five per cent
and needs the owner; you have been signed out, sign in again and the order is still on the screen; the request
never reached us, so nothing was saved and pressing save again is safe. The last part matters most: whether
anything was written is the only thing that decides her next move.

On several valid orders in a row: I could not reproduce that as rate limiting, and there is no throttle in the
system. I sent six valid saves at once against the same project and all six were accepted. What almost certainly
happened is that I deployed a new version while your tab was open. The save runs as a server action, and an action
belonging to a deployment that has been replaced fails. That now surfaces as "the app was updated, reload the page
and press save again, nothing was saved". In a production build I would not leave that to a message: the write
would go through an endpoint that stays stable across deployments, and the token above already makes the retry
safe.

Now the larger question, and it is a fair one.

Qirsh was not thrown away and it was not a false start. It is at
https://github.com/Tony-aphrodite/9-22-supabase and it runs your project's Supabase migrations, nine of them, in
Postgres compiled to WebAssembly inside the browser tab. The screens only ever call rpc(), the same shape as
supabase.rpc(), and the adapter that points those calls at a hosted Supabase project is already in the repository
with a comment explaining exactly that. It ran in the tab because there was no Supabase project to run it against
and I did not want to ask you to create one before you had even looked at it.

Why I built a second thing rather than putting the first on a server: your brief asks each shortlisted candidate
to build one screen, six to eight hours, on my own Vercel and Supabase, tells us what not to build, payments,
stock, quotes, customer management, Arabic and polish, and says you are judging the logic. dealer-order-entry is
that task and nothing more. What I got wrong was how I sent it: a newer link with your branding on it reads as the
newer version of the product, and I should have said plainly that it is the trial task and that Qirsh is the
platform.

Yes, the first version can run with Postgres on a server. What it takes is the Supabase project you now have, the
nine migrations run against it, the browser transport swapped for the adapter that is already written, and
Supabase Auth for the session. The one genuinely new piece is proof photos, which move from the browser to
Supabase Storage. I would rather show that than estimate it. Say the word and I will put Qirsh on the hosted
project with the idempotency and the offline queue it already has, and you can test it the way you tested this
one: connection off, keep working, save, connection back.

Valdis
