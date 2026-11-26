# Clients

Four ways to watch, one server. Everything a client needs comes from the HTTP API in
[API.md](API.md); no client talks to the database, the filesystem or ffmpeg.

| Client | Where | Language | Lines | Playback |
|---|---|---|---|---|
| Web UI | `public/` | vanilla JS, no framework and no bundler | 795 (`app.js`) + 18.7 KB CSS | `hls.js` from `/vendor/`, or native HLS on Safari |
| Android TV / Fire TV | `android/`, the `tv` flavor | Kotlin, Jetpack Compose, Media3 | 544 in `src/tv` + 846 shared | ExoPlayer |
| Android (phone) | `android/`, the `phone` flavor | Kotlin, Jetpack Compose, Media3 | 610 in `src/phone` + 846 shared | ExoPlayer |
| Desktop | `desktop/` | Electron shell + Node supervisor | 131 (`main.js` + `preload.js` + `connect.html`) | the web UI in a `BrowserWindow` |

The web UI is also the setup screen: libraries, sources, channels, ads, announcements, music videos and
security all live in it. Both Android apps carry a settings screen for the server's switches.

## What each client actually calls

Measured from the source, not from intent:

| Route | Web | Android (both) |
|---|---|---|
| `GET /api/channels` | ✓ | ✓ |
| `GET /api/epg` | ✓ | ✓ (`slim=1`) |
| `GET /api/items/:id` | ✓ | ✓ |
| `GET /api/art/:id` | ✓ | ✓ |
| `GET /live/:id/index.m3u8` + segments | ✓ | ✓ |
| `POST /live/:id/stop` | ✓ | ✓ |
| `GET /api/settings`, `PUT /api/settings` | ✓ | ✓ |
| `GET /api/scan`, `POST /api/scan` | ✓ | ✓ |
| `GET /api/libraries`, `/api/browse`, `/api/sources` | ✓ | — |
| `GET /api/ads`, `POST /api/ads`, `DELETE /api/ads/:id` | ✓ | — |
| `/api/auth/*` | ✓ | access key only |
| `/api/imvdb/*`, `/api/promo/*`, `/api/hw`, `/api/live/*` | ✓ | — |

Android asks for the guide with `slim=1` (`Api.kt`), which is the same payload with empty fields
removed — the difference between a comfortable and an uncomfortable response on a TV box.

## What the guide does in every client

Every client implements the same shape, because they render the same `/api/epg` answer:

- a Freeview-style grid with a now/next column and poster, plot, cast, year, rating and genres;
- **filter chips**: All / TV / Movies / Music / Radio / Live / Networks / Genres, plus one chip per
  channel group that owns a channel;
- **pause and rewind** inside the server's window, with a "return to live" action;
- an info banner with a progress bar, "N min left", what is next, and how far behind live the viewer is;
- **channel surfing**: number entry, channel up/down, last channel;
- nine themes (Classic, Vintage, 90s, Modern, Aero, Teletext, Synthwave, and two Satellite looks).

The web UI additionally has keyboard control (arrows, Enter, 0–9, Space, `L`, `F`, `G`/`Esc`, `[` `]`)
and an optional fullscreen-on-select mode.

## Building and running each one

| Client | How |
|---|---|
| Web | nothing to build — `npm start` serves `public/` from `/` |
| Android | `cd android; ./gradlew :app:assembleTvDebug :app:assemblePhoneDebug` — two APKs, two application ids (`com.videodyne.tv` and `com.videodyne.app`), installable side by side; needs Android 8+ |
| Desktop | `cd desktop; npm install; npm start` — see `desktop/README.md` |

## Where the clients diverge, and why it matters

- **The API is readable across origins**: `GET /api/*` and `GET /live/*` carry
  `Access-Control-Allow-Origin: *` (`server.js:37-40`), so an IPTV or web player served from another
  host can read the guide and the streams. Nothing that changes data is opened up.
- **The TV app starts on the last channel**, like a television, rather than on the guide. **The phone app starts on the list** and tunes only when a channel is tapped, because opening an app is not watching.
- **The desktop app is a shell around the web UI**, not a fourth UI: it exists to run the server on a
  machine that is not a container.
- **A client feature is a server feature only if the API grows.** Adding a control to one client means
  a route in `docs/API.md` and a note in this table; anything else is presentation.
