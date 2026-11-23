# Upstream divergence

This fork keeps a written record of everything it changes in WBTV, and of what it offered back.
The point is not bookkeeping. A fork is a diff, every line of that diff is a conflict to resolve on
the next update, and a change the original author accepts is a conflict that never happens again.

Two rules make the record worth reading:

- A change that is not in this table is drift. Drift is either an oversight or a bug, and both get
  fixed rather than documented.
- A row is never deleted. When a change lands upstream the row says `merged`, and this fork's copy
  of it disappears on the next rebase.

## The three kinds of change

| Kind | Fate | Lives in |
|---|---|---|
| Identity - name, palette, idents, tuner metadata | never sent upstream | `brand/`, `public/brand.css`, themes |
| A capability this fork adds - packaging, installers, extra clients | never sent upstream, by choice | new files, reached from the author's files by a single line |
| A general improvement - a bug, a slow path, a stale doc | offered upstream, and the debt disappears when it is merged | `src/`, `public/`, `test/`, `docs/` |

Only the third row can shrink, which is why it is the interesting one.

## The ledger

`Upstream` says whether the change belongs in the author's repository at all.
`Status` is one of `candidate` (could be sent), `queued` (a pull request is already open - one at a
time), `drafted` (text ready, not sent), `open`, `merged`, `declined`, or `not-sent` with the
reason beside it.

| Date | Commit | Lane | What | Upstream | Status | Link |
|---|---|---|---|---|---|---|
| 2026-11-22 | `c1190be` | upstream | Untrack `tools/__pycache__/*.pyc` and add the ignore rule | yes | open | #3 |
| 2026-11-22 | - | upstream | Hardware-encoder results from a real GPU, for the open help-wanted issue | yes | candidate | - |
| 2026-11-22 | `99487f8` | upstream | Test the migration path: an old-shaped database gains every column `migrate()` adds, and the old `libraries` CHECK is rebuilt | yes | candidate | #18 |

## How a row is added

1. The lane trailer in the commit is the claim: `brand`, `fork` or `upstream`.
2. A commit claimed as `upstream` gets its row here in that same commit, with a `Status`.
3. `Status: open`, `merged` or `declined` carries the issue or pull request number.
4. A change that is offered and declined stays in the tree, and its row says so. That is a fork
   change now, not drift.

## What this fork will not send

- A look, a name or a wordmark. The author's screenshots and his users' tuner names are his.
- A wire format: `x-wbtv-key`, `wbtv_session`, `tvg-id="wbtv.` and the `WBTV_` environment prefix.
- The Docker image, its publishing workflow, or its namespace.
- A change that only exists because of something else in this fork.
