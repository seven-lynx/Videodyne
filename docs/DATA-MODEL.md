# Data model

One SQLite file, `<config>/videodyne.db`, opened by `src/db.js:88-108` with `journal_mode=WAL`,
`synchronous=NORMAL`, `foreign_keys=ON` and `busy_timeout=5000`. `node:sqlite`'s `DatabaseSync` is
synchronous, so every write is a blocking call on the event loop — which is why transactions are kept
short and never contain an `await` (`db.js:141-144`).

## 1. Rules that outlive any one table

- **A new column is two edits.** It goes into `SCHEMA` (`db.js:7-83`) *and* into a `migrate()` block
  (`db.js:110-139`). A fresh database gets it from `SCHEMA`; an installed one gets it from the ALTER.
  Adding only one half is the defect that produced issue #2.
- **JSON lives in TEXT.** `studios`, `genres`, `actors` on `shows`/`items` and `segments` on
  `promos` are `JSON.stringify`d arrays. Readers parse them directly (`guide.js:30`), so a writer that
  stores a bare string breaks the guide for that row.
- **Times are Unix seconds**, stored as `REAL`, always UTC. XMLTV formats them back
  (`iptvout.js:13-16`).
- **A path is either a filesystem path or `ms://<sourceId>/<ref>`.** The `ms://` form is how a
  Jellyfin, Emby, Plex or Navidrome item is stored: the reference is resolved to a real URL with the
  credential only at play time (`mediaserver.js`, `plex.js`, `navidrome.js`), so no token is ever in
  a row, a path or a log line.
- **Validity before value.** `runtime = 0` means "unknown", not "zero seconds". `probed` is
  `0` never, `1` known (measured or supplied by an NFO), `2` failed — and a failure is retried on the
  ladder in `media.js:46` (`0`, 1 h, 6 h, 24 h) by `probePending` with four workers, giving up after
  the fourth attempt with one log line. A failed probe never zeroes a duration the NFO supplied
  (`media.js:63-64`).
- **The dead column is gone.** `items.channel_id` and `idx_items_channel` were written by nothing —
  membership is `channel_items` — so #34 removed both: `SCHEMA` no longer creates them and `migrate()`
  drops them from a database that still has one (the index first, because SQLite refuses an indexed
  column). A column nobody writes is dead weight on the largest table, and keeping it "documented"
  only made the next reader wonder what wrote it.

## 2. The tables

Thirteen tables, each owned by one surface. "Writer" is the module that may change rows; anything
else reading them is a consumer.

| Table | Holds | Writer | Cascades |
|---|---|---|---|
| `settings` | one row per setting, plus three unfitted rows: `auth`, `imvdb_key`, `talk_per_title_<libId>` | `db.setSettings`, `auth.js`, `imvdb.js`, `server.js:213` | — |
| `libraries` | each scan root: `type` (13 values), `path`, `channel_group`, `group_mode` | `server.js` | deleting one cascades to `shows`, `items`, `live_streams`, `ads` |
| `sources` | Jellyfin/Emby/Plex/Navidrome servers: `kind`, `url`, `token`, `salt` | `server.js:118-130` | **none** — the link to `libraries` is the `ms://<id>/` path prefix, so a source delete does it by hand (`server.js:134`) |
| `mv_jobs` | the IMVDb download queue: `status` ∈ `queued`, `running`, `done`, `failed`, `cancelled` | `imvdb.js` | — |
| `shows` | a series as its NFO describes it: studio, genre, poster | `scanner.js` | `items.show_id` cascades from it |
| `items` | one playable file: `kind` ∈ `episode`, `movie`, `track`, `musicvideo`, `clip`, `talk`, `live` | `scanner.js` | cascades from `libraries` and `shows`; deleting one cascades to `channel_items`, `programmes`, `blocks` |
| `live_streams` | one IPTV/HLS/YouTube source: `src_kind` ∈ `hls`, `youtube`, playlist entry, with `alive` and `checked` | `iptv.js` | cascades from `libraries` |
| `channels` | one station: `key` (unique), `kind`, `auto_name`, `name_override`, `number`, `enabled`, `item_count`, `grp`, `network` | `channels.js` | cascades to `channel_items`, `programmes`, `blocks` |
| `channel_items` | membership, `PRIMARY KEY (channel_id, item_id)` | `channels.js:262` | both sides cascade |
| `ads` | an advert, ident or bumper: `status` ∈ `pending`, `resolving`, `ready`, `error`; `kind` ∈ `all`, `tv`, `movie`, `ident` | `ads.js`, `scanner.js` (an ads library) | cascades from `libraries` |
| `programmes` | what the guide shows: one row per airing, `start`/`end` | `scheduler.js` | cascades from `channels` and `items` |
| `blocks` | the playable pieces inside an airing: `kind` ∈ `content`, `ad`, `promo`, `ident`, `signoff`; `in_point` is the offset into the file | `scheduler.js` | cascades from channel, programme, item and ad |
| `promos` | a generated announcement: `segments` (JSON) and `est` seconds | `scheduler.js:157` | **none** — `blocks.promo_id` is a plain integer, so a deleted promo leaves a dangling id and the block simply has no narration |

## 3. Columns, in full

Every column below exists in `SCHEMA`; the note is only where the name does not say everything.

| Table | Columns |
|---|---|
| `settings` | `key` PK, `value` — the value is `JSON.stringify`d and re-fitted on read (`getSettings`), so a hand-edited bad row is ignored rather than trusted |
| `libraries` | `id`, `name`, `path` UNIQUE, `type`, `last_scan` (ms), `channel_group` (the guide chip, and the channel name in `single`/`both` mode), `group_mode` ∈ `inferred`, `single`, `both` |
| `sources` | `id`, `kind` ∈ `jellyfin`, `emby`, `plex`, `navidrome`, `name`, `url` UNIQUE, `token`, `user_id`, `salt` (Navidrome only) — never returned by a route (`server.js:114`) |
| `mv_jobs` | `id`, `imvdb_id` UNIQUE, `artist`, `title`, `year`, `status`, `error` (last 300 chars), `file` (relative to the library), `created`, `updated` (ms), `force` (keep it even if it looks like a still or a lyric video) |
| `shows` | `id`, `library_id`, `path` UNIQUE, `title`, `plot`, `year`, `rating`, `mpaa`, `studios`, `genres`, `poster` (a file under `config/covers`) |
| `items` | `id`, `library_id`, `show_id`, `kind`, `path` UNIQUE, `title`, `plot`, `year`, `season`, `episode`, `aired`, `rating`, `mpaa`, `runtime`, `probed`, `studios`, `genres`, `actors`, `poster`, `mtime`, `size`, `nfo_mtime` (when the sidecar was last read), `artist`, `album`, `probe_attempts`, `probe_checked` (seconds) |
| `live_streams` | `id`, `library_id`, `name`, `url`, `grp` (the playlist's `group-title`), `logo`, `tvg_id`, `src_kind` ∈ `hls`, `youtube`, …, `alive` (NULL = never checked), `checked` (seconds), `channel_id`, `UNIQUE(library_id, url)` |
| `channels` | `id`, `key` UNIQUE (the inference identity, e.g. `studio:bbc one`), `kind` ∈ `tv`, `movie`, `music`, `radio`, `clips`, `live`, `talk`, `auto_name` (what inference chose), `name_override` (what the user chose — `COALESCE`d over the auto name at every read), `number`, `enabled`, `item_count` (denormalised, recomputed by `inferChannels`), `grp`, `network` (the brand a genre, era or catch-all channel belongs to — `channels.js`'s roster; NULL for a studio, group, talk or live channel) |
| `channel_items` | `channel_id`, `item_id`, PK on both |
| `ads` | `id`, `title`, `source` UNIQUE (the URL it came from), `file` (a path, or an archive.org URL that is streamed rather than stored), `duration`, `status`, `error`, `kind`, `library_id` |
| `programmes` | `id`, `channel_id`, `item_id`, `start`, `end` — one row per airing; a live channel has none |
| `blocks` | `id`, `channel_id`, `programme_id`, `kind`, `item_id`, `ad_id`, `in_point` (seconds into the file where the block starts), `start`, `end`, `promo_id` |
| `promos` | `id`, `segments` (JSON: `[{label, text}]`), `est` (estimated seconds, used to fit the slot before the audio exists) |

Nothing stores a foreign key to `promos`, and `sources` is linked to `libraries` only by the
`ms://` prefix. Both are deliberate: a promo can be regenerated, and a source can be re-added without
rewriting every path.

## 4. Indexes, and the query each one serves

| Index | Serves |
|---|---|
| `idx_items_channel` | nothing (#34) |
| `idx_items_lib` | the scan's per-library sweep and `item_count` |
| `idx_items_show` | the show cascade and episode lookup by show |
| `idx_shows_lib` | the show cascade on a library delete |
| `idx_prog` (`channel_id, start`) | the guide window and "what is on now" |
| `idx_prog_item` | the programme cascade when an item goes |
| `idx_ci_item` | the `channel_items` cascade from `items` |
| `idx_blocks` (`channel_id, start`) | `getBlockAt` — every segment decision the broadcaster makes |
| `idx_blocks_prog`, `idx_blocks_ad`, `idx_blocks_item` | the three cascades into `blocks` |

## 5. What grows

| Thing | Grows by | Trimmed by |
|---|---|---|
| `programmes` | one row per airing, per channel, per roll-forward | `prune` (`scheduler.js:371-376`): everything that ended more than 3 h ago |
| `blocks` | 1 + one per ad, ident and promo, per airing | the same prune, same cut-off |
| `promos` | one row per generated announcement | the same prune deletes any promo no block refers to |
| `items` | one row per file | `safeRemovals` on scan, two scans apart |
| `ads` | one row per URL added | the user; `DELETE /api/ads/:id` also re-plans |
| `mv_jobs` | one row per queued video | `DELETE /api/imvdb/jobs` clears done/failed/cancelled |
| `config/covers` | one image per poster, capped at 300 downloads per scan | nothing |
| `config/tts` | one audio file per announcement | `pruneCache`, 3 days, every 6 h |
| `config/live/*` (tmpfs) | 4-second segments | the broadcaster's 25 s reaper and the boot-time wipe (`server.js:497`) |

## 6. Migrations that exist today

`migrate()` (`db.js:110-141`) is six independent repairs, each guarded by what it finds, so it is safe
to run on every open:

1. a pre-`music` `libraries` table whose `CHECK` refused every new type is rebuilt without it
   (foreign keys off, copy, drop, rename, back on);
2. `items.artist`, `items.album`;
3. `items.probe_attempts`, `items.probe_checked`;
4. `blocks.promo_id`;
5. `channels.grp`, `channels.network`;
6. `libraries.channel_group`, `libraries.group_mode`, `mv_jobs.force`, `sources.salt`, `ads.kind`.

A schema change that drops or renames a populated column is not a migration — it is an owner
decision, because an installed database is somebody's library.

