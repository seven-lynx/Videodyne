# Tools

Five scripts under `tools/`. Two of them are **part of the server**, which is why the directory is
copied into the image (`Dockerfile:29`) rather than shipped alongside it.

| Tool | Runs where | What it does |
|---|---|---|
| `mvtool.mjs` | anywhere, with a database copy | audits, fixes and undoes a music-video folder: renames to `Artist/Artist - Title.mp4`, writes the NFO and poster, parks duplicates in `.duplicates` |
| `mvdl.py` | your own computer | a standalone downloader: artists from Navidrome, video lists from MusicBrainz, files from `yt-dlp`, the same folder layout |
| `jfplan.mjs` | anywhere | reads a Jellyfin server and proposes a matching set of libraries and channel groups (read-only) |
| `mvlib.mjs` | **imported by the server** | the library index and name normalisation used when a music video is placed |
| `mvfix.mjs` | **imported by the server** | the file-name and NFO repair used by the same path |

`tools/README.md` is the user-facing guide for `mvtool` and `mvdl.py`, with the Docker invocations.

## The load-bearing two

`src/imvdb.js:11-12` imports `../tools/mvlib.mjs` and `../tools/mvfix.mjs`. Deleting `tools/`, or
excluding it from an image, breaks the server **at import time** — before it can listen, so the
container exits rather than degrading. A change to either file is a change to the server and is tested
by the suite (`test/mvlib.test.js`, `test/mvfix.test.js`).

## The standalone three

- **`mvtool`** has three verbs and is a dry run by default: `audit` (read-only report), `fix` (renames
  and writes, `--apply` to act) and `undo` (replays the log in `<folder>/.mvtool/<date>/undo.json`).
  It reads years and genres from the server's own database — the earliest real year of the matching
  song and its genre — and leaves a folder it does not recognise alone.
- **`mvdl.py`** keeps only official uploads, rejects lyric and audio videos and still images, and can
  read text files of YouTube links (`top 20 --lists lists` writes one empty file per artist).
- **`jfplan.mjs`** proposes; it never writes to Jellyfin or to the server.

All three are convenience: nothing in `src/` depends on them, and the server's own music-video path
(`imvdb.js`) does not call them at runtime beyond `mvlib`/`mvfix`.

## Why they live here rather than in a separate repository

`mvdl.py` writes exactly the layout `scanner.js` reads (`Artist/Artist - Title.mp4` + `.nfo` +
poster), so the two stay in step by being in the same tree. The `mvtool` undo log is the reason it can
be offered at all: a tool that renames a media library must be reversible.
