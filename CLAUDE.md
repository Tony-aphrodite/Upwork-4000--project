# Shamsy platform (built from Qirsh)

@HANDOFF.md

## Working rules for this project

- **The client log is `chatting.md`** at the root. In the user's original folder it is a link to
  `qirsh/project-notes/chatting.md`. Append each new client message as the next numbered section, following the
  workspace rules below. Section 5 is the design reference;
  section 6 records the start on 2026-10-01. Since 2026-10-01 the client also writes in a group chat; log those
  messages the same way and say in each section whether it came from Upwork or the group.
- **Design questions from the client:** adapt the held design message in `chatting.md` section 8 to what the client
  asks. Do not send it unchanged.
- **Milestones, payment or dates raised by the client:** send the held milestone plan in `chatting.md` section 7,
  adapted as its "Status" says. It has not been given to the client yet.
- **2026-10-01 to about 2026-10-11, the user's friend runs the project.** See the first section of `HANDOFF.md`.
- **`SCOPE-REVIEW.md`** compares the brief, the Qirsh code and the milestone plan. Use it for specifications, the
  architecture document and the questions to Michael.
- **Scope is steps 1 to 9 of the final brief, for a fixed US$4,000.** Anything beyond the brief or the agreed
  acceptance tests is new work: name it, and get it approved separately. Never absorb it quietly.
- **Every milestone is a pull request the technical lead (Michael) approves.**
  - TypeScript, tests with every change, GitHub Actions green, documentation written with the feature.
  - Money is integers. Rates are stored on the rows. A saved past never moves.
- **Confidential client.**
  - No Shamsy names, figures or files in anything public: no public repositories, no demo deployments.
  - This project's repository (`Tony-aphrodite/Upwork-4000--project`) must stay private.
  - Real data only after the confidentiality agreement is signed. Staging uses invented or masked data.
- **Two Supabase projects, never mixed up.** `.secrets/demo-supabase.env` is our demo project behind qirsh-live.
  Production is the client's own EU project. Never print, commit or send the credentials.
- **Git: commit locally, and push only after the user approves each push.**
- **Videos.** The user does not appear on camera. Progress videos are captioned screen recordings, or narrated with
  a neutral text-to-speech voice. Never animate a real person's face, and never imitate a real person's voice.

## Rules from the user's workspace

These come from the workspace `CLAUDE.md` one folder up on the user's machine. They are copied here because a clone of
this project does not include that file. If both are present, they say the same thing.

**Who you work for**
- The user, and during the handover the user's friend, write in Korean. **Reply in Korean.**
- On Upwork the user works under the name **Valdis Licis**. Every message to the client is signed "Valdis".
- **Every file is in English, with zero Korean characters.** This covers code, notes, `chatting.md`, client
  messages, commit messages and documents. Before finishing, grep the files you touched for Hangul
  (`[\x{AC00}-\x{D7A3}\x{3130}-\x{318F}]`).

**Client messages**
- When a client message is pasted, append a new numbered section to `chatting.md`:
  - the message, verbatim, as a quote;
  - an analysis;
  - a ready-to-send reply, signed Valdis;
  - prep notes when needed.
- Then give a short summary in Korean, with the reply in a code block.
- **Read the log first.** Read `HANDOFF.md` and the recent sections of `chatting.md`, so a reply never contradicts
  what was already sent.
- **Client ready to start or confirm: no question at the end.** State open points as decisions, and end with the
  next step.
- **Keep it short when asked for short.**
- **Never invent** experience, clients or certifications.
- **Never quote a price or rate the user has not agreed.**
- **Upwork rules:**
  - payments and milestones stay on Upwork;
  - never suggest account sharing.

**Engineering habits**
- **Verify before claiming.** Run the tests and the build. For UI work, look at the real pages in a browser at
  desktop width and at 390 px. Check that nothing scrolls sideways and that there are no console errors.
- **Node 22 for the Qirsh tests and build** (`node -v` should show v22).
- **Secrets.**
  - Never print them.
  - Clients paste their own keys into settings; never take a key by chat.
  - The user runs destructive statements on hosted databases themselves.
- **Fictional or demo data** uses the phone number `0123456789`. Real client data is used as given.
- **Git.** Commit messages end with the co-author trailer the session provides.
