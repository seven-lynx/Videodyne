# Documentation

One page to find the right document. Everything here describes the code in this repository, and
where a document makes a claim about behaviour it names the file and line so the claim can be
checked rather than believed.

## Start here, by question

| I want to… | Read |
|---|---|
| install it, add libraries and watch something | [FEATURES.md](FEATURES.md) — every user-visible feature, by area |
| understand how the code fits together | [ARCHITECTURE.md](ARCHITECTURE.md) — the process, the module graph, startup, the channel lifecycle |
| know what the database holds | [DATA-MODEL.md](DATA-MODEL.md) — every table, column and invariant |
| know what a channel is called, and why | [CHANNELS.md](CHANNELS.md) — the roster: every network, its channels, the eras and the catch-alls |
| change a switch in the UI, or find out what it does | [SETTINGS.md](SETTINGS.md) — all 34 settings, their ranges and their effect |
| know why a particular programme is on now | [SCHEDULE.md](SCHEDULE.md) — the horizon, the picking rules, ad breaks, dayparting, closedown |
| set a deploy-time option or size the container | [ENVIRONMENT.md](ENVIRONMENT.md) — every environment variable and the container's facts |
| see what ffmpeg is told to do, and what a failure looks like | [BROADCAST.md](BROADCAST.md) — segments, filtergraphs, the pause window, the log lines |
| find out how a file becomes a channel item | [SCANNING.md](SCANNING.md) — the 13 library types, NFO fields, probe retries, removals, media servers |
| work on the web UI, the TV apps or the desktop shell | [CLIENTS.md](CLIENTS.md) — what each client can do and the routes it calls |
| use the command-line tools, or move them | [TOOLS.md](TOOLS.md) — the five scripts, and the two the server imports |
| fix something at 9pm | [OPERATIONS.md](OPERATIONS.md) — status fields, log lines, symptom → cause → action, backup |
| change the code | [DEVELOPMENT.md](DEVELOPMENT.md) — run it, test it, and the checklists for a route, a setting, a library type or a module |
| be sure what a word means | [GLOSSARY.md](GLOSSARY.md) — programme, block, segment, reel, ident, promo, horizon |
| script it or build a client | [API.md](API.md) — every route, payload and authentication rule |
| know how it compares with other tools | [COMPARISON.md](COMPARISON.md) |
| know what this fork changed, and what it offered back | [UPSTREAM.md](UPSTREAM.md) |

## Reading orders

- **New user** — the top of the README, then `FEATURES.md` for the area you care about. Nothing else
  is needed to run it.
- **Operator** — `FEATURES.md` §Performance and §Reliability, then the README's configuration table.
- **Contributor** — `API.md` for the contract, `COMPARISON.md` for the shape of the product, and
  `UPSTREAM.md` before changing anything that upstream also owns.

## Conventions

- This directory is the tracked documentation. Plans, audits and working notes are local-only and
  never cited from here.
- A document answers one question. If two documents answer the same question, one of them is wrong.
- Documents are written without the product's name where a sentence allows it, so a rename does not
  invalidate them.
- Two of these files are checked by the test suite: `API.md` against the routes the server registers
  (`test/api-docs.test.js`), and this index against the directory it lists
  (`test/docs-index.test.js`). A document that is not linked here fails `npm test`.
