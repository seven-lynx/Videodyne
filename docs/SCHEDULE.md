# Schedule

The schedule is generated ahead of time and **persisted**, so the guide, the stream and the XMLTV feed
always describe the same thing, and "what was on an hour ago" is a query rather than a guess
(`scheduler.js:6-12`).

Two tables carry it: `programmes` is what the guide shows, `blocks` is what actually plays. One
programme is usually several blocks — the content slices and the adverts between them.

## 1. The window

| Constant | Value | Meaning |
|---|---|---|
| `HORIZON_HOURS` | 14 | how far ahead every channel is planned |
| `HISTORY_HOURS` | 2 | a channel with no schedule starts no earlier than this, so a fresh install does not backfill yesterday |
| prune cut-off | 3 h | everything that ended earlier is deleted (`scheduler.js:371-376`) |
| top-up | every 10 min | `server.js:507`; a broadcaster that finds a hole calls `ensureChannelSchedule` for its own channel |

The 14-hour horizon is the reason `iptvout.js` asks for 14 hours of guide (`iptvout.js:43`): asking
for more leaves an IPTV player's grid blank at the end.

## 2. One channel at a time, never two planners

`ensureSchedule` (`scheduler.js:386-401`) is single-flight: a second call while one is running returns
the same promise. It builds the plan context once (settings, ready adverts, idents), then plans each
channel and `setImmediate`s between them so the web server stays responsive. A channel that throws is
logged and skipped — one broken channel must not stop the eleven after it.

`rescheduleFuture` (`scheduler.js:404-416`) is the destructive one: it waits for a running plan, then
deletes future `programmes` and any orphaned ad blocks in one transaction, and re-plans. It is called
when a setting, a library or a channel changes.

## 3. Choosing what airs

`makePicker` (`scheduler.js:28-79`) reads the last 400 programmes on the channel and then:

| Channel kind | Rule |
|---|---|
| movies | never one of the last `min(films/2, 100)` films it aired, then a daypart-weighted random pick |
| tv | pick a **show**, never the same one twice in a row, then air that show's **next episode** in season/episode order, wrapping to the first |
| tv, with films mixed in (a channel group) | `show_id` is null for films, so they are picked at random and never the one just played |

Two details that look like bugs and are not: a show's episodes are ordered by `season`, `episode`,
then path (`scheduler.js:54`), and the "where the show got to" position is recovered from what already
aired — which is why a restart continues the series rather than starting it again.

Dayparting is a **weight**, never a filter (`weigher`, `scheduler.js:20-26`): with `autoDaypart` off
every item weighs 1; with it on, `classify` puts the item in a bucket from its genres and age rating
and `daypartWeight` scores it for the hour. A channel therefore never runs out of things to play — it
just plays the right things more often.

## 4. Filling one slot, in order

For every programme the planner emits (`extendChannel`, `scheduler.js:134-237`):

1. **Closedown first.** If the clock is inside the sign-off window, one `signoff` block covers the
   whole window and planning resumes when it ends (`scheduler.js:168-170`).
2. **Before the programme**: adverts up to the next grid line (`alignMinutes`), then the "coming up
   next" announcement, then the station ident. The order is deliberate — the promise is that the
   programme starts on the grid line, so the filler goes before it, sized to fit.
3. **The ident** is the user's own clip when an ident library has one of 1–20 s, otherwise a generated
   card of `IDENT_SECONDS = 5` (`scheduler.js:107,178-183`).
4. **The programme is split** only when adverts are on and it runs at least 15 minutes:
   `breakSegments(D, every) = clamp(round(D / everyMinutes), 2, 40)` parts (`scheduler.js:110-113`),
   each cut nudged by ±6 % of a part so breaks do not land on the same beat every time.
5. **Each mid-break** targets `breakLengthMinutes × 60 × rand(0.7, 1.2)` seconds (`scheduler.js:228`),
   filled by `fillAds`.
6. The `programmes` row is inserted with `end = start` and corrected once its last block is placed
   (`scheduler.js:223,234`) — a programme's duration is the sum of its blocks, not the file's runtime.

`fillAds` (`scheduler.js:84-105`) is worth knowing when adverts look odd: an ad is never repeated
inside one break, never the same one twice running across breaks, and a "reel" — anything over
`REEL = 600` seconds, i.e. a recorded ad break — is entered at a random offset and played for as long
as the slot needs. A tiny pool falls back to repeats rather than silence; a block loop is capped at 60
pieces.

## 5. The other three channel shapes

| Kind | What a "programme" is | Where |
|---|---|---|
| music, clips, radio | a 30-minute rotation of tracks, one block per track; the guide entry's title is the first track and its description is the whole list | `extendRotation`, `scheduler.js:245-278` |
| talk (podcasts, audiobooks, interviews) | one item per entry, no adverts, no announcements | `extendTalk`, `scheduler.js:295-356` |

Rotation rules: a zero-length file is filtered out (it would otherwise add thousands of blocks to fill
half an hour), the last `min(tracks/2, 200)` tracks are avoided, and the same artist is not played
twice in a row when the pool allows it (`scheduler.js:260`).

Talk rules, per library type:

- **interviews** — shuffled, avoiding the last `min(items/2, 100)`.
- **podcasts** — grouped by album (else artist), each group in `episodeOrder` (air date, then
  disc/track, then file name), rotating between shows and continuing each show where it left off.
- **audiobooks** — one book at a time: the next chapter, then the next book starting at chapter one.

The position comes from the last 400 rows of `programmes`, so a restart resumes the story.

## 6. Dayparting and era-matched adverts

`daypart.js` holds the two pure functions that decide this, and both are testable without a server:

- `classify(genres, rating)` folds genres and a normalised age rating into a bucket (children,
  family, general, teen, adult, horror and so on).
- `daypartWeight(bucket, ts)` scores a bucket for a local hour — cartoons after school and on Saturday
  morning, horror and mature content late.
- `guessAdYear(text)` reads a year out of an ad's title or folder (`1994`, `1990s`, `80s`);
  `programmeYear(item)` answers the programme's; `eraWeight` prefers the near ones.

Both are *soft*: no item is ever excluded, and `pickWeighted` (`daypart.js`) only changes how often
something comes up.

## 7. Closedown

`signOffEnd(settings, t)` (`scheduler.js:120-132`) answers "when does the closedown that contains `t`
end", or null. A window that crosses midnight (`23:00`–`06:00`) is handled, and `from === to` means
"off" rather than "all day". The guide shows the block as *Off air / Closedown* (`guide.js:77-82`), and
the broadcaster plays a test card for it.

## 8. Why a rescan does not reshuffle the guide

`runScan` (`server.js:58-100`) records how many upcoming programmes each channel has **before**
scanning, then again after, and re-plans only the channels that lost some (their media vanished). A
scan that found no change does not even rebuild the channel list (`server.js:79`). That is what keeps
"what's on at 8" stable across an hourly rescan — the alternative, re-planning everything, would change
the answer every hour.

## 9. What a planner failure looks like

- One channel throwing → `[plan] channel N could not be planned: …`, the rest continue
  (`scheduler.js:394`).
- No items with a known runtime → that channel is skipped silently: `extendChannel` returns when its
  item query is empty (`scheduler.js:143-144`). A channel in the guide with nothing on it therefore
  means "every item on it is unprobed", which is a scanning problem, not a scheduling one.
- A hole found at play time → the broadcaster calls `ensureChannelSchedule` for its own channel only
  (`broadcaster.js:20`, via `scheduler.js:379-382`).

