# Message to send with the hosted Qirsh link

Qirsh is on a hosted Supabase project now:

https://qirsh-live.vercel.app

Sign in with any of the people listed on the page; tapping a name fills the form. The password for all of them is `qirsh-demo`. Amira Hassan is an adviser, Hamid Osman is the owner, Yasir Babiker is the dealer's owner in a second environment.

**Connection off, keep working, save, connection back.** Open New order, turn the connection off, choose a dealer, add products, type a rate, save. It tells you the save is on the phone. Turn the connection back on and it goes up by itself. Reloading while the connection is still off is worth trying too: the app comes back, and the dealer list and the catalogue are still searchable, because the phone keeps a copy of what it last read and says so rather than passing it off as current. Every save carries an id made on the phone, so a save that is sent twice is still one order. I sent the same save three times at once and the server made one.

**Calling the database directly as an adviser.** The key the app uses is in the page, as it is in any Supabase app, and your session comes from Supabase Auth, so you can point a script at PostgREST and ask it anything. There is also a page in the app that does it for you: "Try it against this server" in the sidebar. It makes eight attempts from the browser as whoever is signed in - another tenant's orders, the cost tables, inserting an order straight into the table, changing a saved order, approving your own discount, calling a private helper - and prints what the database answered. All eight are refused. Nothing there is enforced by the screen.

Two things worth knowing. Proof photos are in a private Storage bucket, named after the tenant and the receipt, and are read through links that last five minutes; a photo cannot be replaced or deleted once it is attached, the same way the receipt cannot. And the money numbers - landed cost, margin per sale, gain and loss on the rate - live in a schema the application role cannot reach at all; the owner's reports read them through functions that check the role first, which is why an adviser asking for the margin report gets "Your role (adviser) cannot do this" rather than an empty page.

The data is about a hundred days of invented business for an invented company. Every phone number in it is 0123456789.
