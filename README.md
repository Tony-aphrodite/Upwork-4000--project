# Shamsy platform (built from Qirsh): confidential

This is the working repository for a client project under a fixed-price Upwork contract. It holds the client's
confidential brief, files and conversation log, so it must stay **private**. Never make it public, and never copy its
contents into a public repository or deployment.

## Start here

1. Read `HANDOFF.md`, first its opening section ("the user's friend runs the project").
2. Read the summary of `SCOPE-REVIEW.md`.
3. Open Claude Code at the root of this repository. `CLAUDE.md` loads the project rules and the handoff.
4. To work on a client message, paste it into Claude Code. It is logged in `chatting.md` with a reply ready to send.

## Run the code

The Qirsh code is in `qirsh/`. It needs **Node 22**.

```bash
cd qirsh
npm ci
npm run dev    # http://localhost:4331, with the database in the browser and invented data; no keys needed
npm test       # the money rules, and every migration and acceptance check in Postgres (PGlite)
npm run ci     # typecheck, tests and build
```

`qirsh/README.md` explains what is built, `qirsh/NOTES.md` the decisions and open questions, and `qirsh/HOSTING.md`
the hosted Supabase set-up.

## Never commit

- `.secrets/`: the credentials for our own demo database. They are not in this repository, and nobody needs them for
  the design or the specification work.
- `.env` files, and `.vercel/`.

## Layout

| Path | What it is |
| --- | --- |
| `HANDOFF.md` | The state of the project and the next steps |
| `SCOPE-REVIEW.md` | The brief against the Qirsh code and the milestone plan |
| `chatting.md` | The client conversation log, with replies ready to send |
| `WORKLOG.md` | Sessions and hours against the 306-hour budget |
| `client-files/` | The confidential brief, the client's dashboard prototype and the design reference screens |
| `deliverables/` | Videos and documents already sent to the client |
| `history/` | The bid and the messages sent during the trial |
| `qirsh/` | The code |
