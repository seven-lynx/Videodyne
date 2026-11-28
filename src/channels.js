import { tx, getSettings } from './db.js';
import { TALK } from './scanner.js';

// ---- naming -------------------------------------------------------------

// A network is a brand word and its channels lead with it: `Nightshade` (shows) and `Nightshade
// Grindhouse` (films) are two channels of one network, and a horror viewer who learns 110 learns 310
// by adding 200. The medium is never in the name - no `TV`, `Cinema`, `Movies` or `FM` - because the
// number band and the guide's network chip are what say which is which.
//
// The roster is explicit and append-only: an entry names the channels of one network, the genres each
// answers to, and the number block its channels are allocated from. Array order means nothing, and a
// genre that is not on the roster invents no channel of its own: the item falls to the medium's
// catch-all, because a genre nobody funded is not a brand.
const NETWORKS = [
  { id: 'nightshade', brand: 'Nightshade', tv: 110, film: 310, channels: [
    { kind: 'tv', name: 'Nightshade', genres: ['horror'] },
    { kind: 'movie', name: 'Nightshade Grindhouse', genres: ['horror'] },
  ] },
  { id: 'nailbiter', brand: 'Nailbiter', tv: 113, film: 313, channels: [
    { kind: 'tv', name: 'Nailbiter', genres: ['thriller', 'suspense'] },
    { kind: 'movie', name: 'Nailbiter After Dark', genres: ['thriller'] },
  ] },
  { id: 'chortle', brand: 'Chortle', tv: 116, film: 316, channels: [
    { kind: 'tv', name: 'Chortle', genres: ['comedy'] },
    { kind: 'tv', name: 'Chortle Open Mic', genres: ['stand-up', 'stand up'] },
    { kind: 'movie', name: 'Chortle House', genres: ['comedy'] },
  ] },
  { id: 'longform', brand: 'Longform', tv: 119, film: 319, channels: [
    { kind: 'tv', name: 'Longform', genres: ['drama'] },
    { kind: 'tv', name: 'Longform Short Season', genres: ['mini-series'] },
    { kind: 'movie', name: 'Longform Goldleaf', genres: ['drama'] },
    { kind: 'movie', name: 'Longform Teleplay', genres: ['tv movie'] },
  ] },
  { id: 'herringbone', brand: 'Herringbone', tv: 122, film: 322, channels: [
    { kind: 'tv', name: 'Herringbone', genres: ['mystery'] },
    { kind: 'movie', name: 'Herringbone Cipher', genres: ['mystery'] },
  ] },
  { id: 'gavel', brand: 'Gavel', tv: 125, film: 325, channels: [
    { kind: 'tv', name: 'Gavel', genres: ['crime'] },
    { kind: 'movie', name: 'Gavel Lineup', genres: ['crime'] },
  ] },
  { id: 'slowburn', brand: 'Slowburn', tv: 128, film: 328, channels: [
    { kind: 'tv', name: 'Slowburn', genres: ['romance'] },
    { kind: 'tv', name: 'Slowburn Longstory', genres: ['soap'] },
    { kind: 'movie', name: 'Slowburn Candlelight', genres: ['romance'] },
  ] },
  { id: 'warpwell', brand: 'Warpwell', tv: 131, film: 331, channels: [
    { kind: 'tv', name: 'Warpwell', genres: ['science fiction', 'sci-fi', 'sci-fi & fantasy'] },
    { kind: 'movie', name: 'Warpwell Deep Field', genres: ['science fiction', 'sci-fi'] },
  ] },
  { id: 'runegate', brand: 'Runegate', tv: 134, film: 334, channels: [
    { kind: 'tv', name: 'Runegate', genres: ['fantasy'] },
    { kind: 'movie', name: 'Runegate Mythos', genres: ['fantasy'] },
  ] },
  { id: 'hearthside', brand: 'Hearthside', tv: 137, film: 337, channels: [
    { kind: 'tv', name: 'Hearthside', genres: ['family'] },
    { kind: 'tv', name: 'Hearthside Kites', genres: ['children', 'kids'] },
    { kind: 'movie', name: 'Hearthside Popcorn', genres: ['family'] },
  ] },
  { id: 'inkwell', brand: 'Inkwell', tv: 140, film: 340, channels: [
    { kind: 'tv', name: 'Inkwell', genres: ['animation'] },
    { kind: 'tv', name: 'Inkwell Cel Frame', genres: ['anime'] },
    { kind: 'movie', name: 'Inkwell Flipbook', genres: ['animation'] },
  ] },
  { id: 'fieldwork', brand: 'Fieldwork', tv: 143, channels: [
    { kind: 'tv', name: 'Fieldwork', genres: ['documentary'] },
  ] },
  { id: 'redline', brand: 'Redline', tv: 146, film: 346, channels: [
    { kind: 'tv', name: 'Redline', genres: ['action', 'action & adventure'] },
    { kind: 'movie', name: 'Redline Blast Radius', genres: ['action'] },
  ] },
  { id: 'trailhead', brand: 'Trailhead', tv: 149, film: 349, channels: [
    { kind: 'tv', name: 'Trailhead', genres: ['adventure'] },
    { kind: 'movie', name: 'Trailhead Compass Rose', genres: ['adventure'] },
  ] },
  { id: 'foxhole', brand: 'Foxhole', tv: 152, film: 352, channels: [
    { kind: 'tv', name: 'Foxhole', genres: ['war', 'war & politics'] },
    { kind: 'movie', name: 'Foxhole Beachhead', genres: ['war'] },
  ] },
  { id: 'dustline', brand: 'Dustline', tv: 155, channels: [
    { kind: 'tv', name: 'Dustline', genres: ['western'] },
  ] },
  { id: 'recollect', brand: 'Recollect', tv: 158, film: 358, channels: [
    { kind: 'tv', name: 'Recollect', genres: ['history'] },
    { kind: 'movie', name: 'Recollect Monolith', genres: ['history'] },
  ] },
  { id: 'portrait', brand: 'Portrait', tv: 161, film: 361, channels: [
    { kind: 'tv', name: 'Portrait', genres: ['biography'] },
    { kind: 'movie', name: 'Portrait Testament', genres: ['biography'] },
  ] },
  { id: 'backbeat', brand: 'Backbeat', tv: 164, film: 364, channels: [
    { kind: 'tv', name: 'Backbeat', genres: ['music'] },
    { kind: 'movie', name: 'Backbeat Amplifier', genres: ['music'] },
  ] },
  { id: 'marquee', brand: 'Marquee', tv: 167, channels: [
    { kind: 'tv', name: 'Marquee', genres: ['musical'] },
  ] },
  // Real networks are lumpy: these four film channels have no TV sibling, so they sit in the film band
  // on their own with no partner 200 below to mirror.
  { id: 'verity', brand: 'Verity', film: 370, channels: [
    { kind: 'movie', name: 'Verity', genres: ['documentary'] },
  ] },
  { id: 'tumbleweed', brand: 'Tumbleweed', film: 373, channels: [
    { kind: 'movie', name: 'Tumbleweed', genres: ['western'] },
  ] },
  { id: 'overture', brand: 'Overture', film: 376, channels: [
    { kind: 'movie', name: 'Overture', genres: ['musical'] },
  ] },
  { id: 'guffaw', brand: 'Guffaw', film: 379, channels: [
    { kind: 'movie', name: 'Guffaw', genres: ['comedy'] },
  ] },
  // One-brand TV channels: a genre with no film counterpart still belongs to a network of its own.
  { id: 'buzzer', brand: 'Buzzer', tv: 170, channels: [{ kind: 'tv', name: 'Buzzer', genres: ['game show'] }] },
  { id: 'after-hours', brand: 'After Hours', tv: 173, channels: [{ kind: 'tv', name: 'After Hours', genres: ['talk', 'talk show'] }] },
  { id: 'unscripted', brand: 'Unscripted', tv: 176, channels: [{ kind: 'tv', name: 'Unscripted', genres: ['reality', 'reality-tv'] }] },
  { id: 'skillet', brand: 'Skillet', tv: 179, channels: [{ kind: 'tv', name: 'Skillet', genres: ['food'] }] },
  { id: 'passages', brand: 'Passages', tv: 182, channels: [{ kind: 'tv', name: 'Passages', genres: ['travel'] }] },
  { id: 'curio', brand: 'Curio', tv: 185, channels: [{ kind: 'tv', name: 'Curio', genres: ['special interest'] }] },
  { id: 'extra-time', brand: 'Extra Time', tv: 188, channels: [{ kind: 'tv', name: 'Extra Time', genres: ['sport', 'sports'] }] },
  { id: 'bulletin', brand: 'Bulletin', tv: 191, channels: [{ kind: 'tv', name: 'Bulletin', genres: ['news'] }] },
  { id: 'small-print', brand: 'Small Print', tv: 194, channels: [{ kind: 'tv', name: 'Small Print', genres: ['indie'] }] },
];

/** `kind\0genre` -> the channel that genre airs on, built once at import so a name is spelled in one place. */
const GENRE_CHANNELS = new Map();
for (const n of NETWORKS) for (const c of n.channels) for (const g of c.genres) GENRE_CHANNELS.set(`${c.kind}\u0000${g}`, { network: n.id, name: c.name });

const title = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/** The channel a genre airs on, or null when the roster has no row for it - the caller then falls back to the catch-all. */
function genreChannelName(kind, genre) {
  return GENRE_CHANNELS.get(`${kind}\u0000${genre.toLowerCase().trim()}`) || null;
}

// A music station is its video channel plus a dial position, the way a real one is known by its
// frequency: `Blocks` and `Blocks 92.1` are one network, and the numeral stands where a generic "FM"
// used to. `key` is the station's identity, carried over from before the rename so that a rebuild
// renames the channel instead of recreating it and handing it a new number.
const MUSIC_FAMILIES = [
  { id: 'blocks', key: 'urban beats', brand: 'Blocks', dial: '92.1', genres: ['hip', 'rap'] },
  { id: 'velour', key: 'smooth grooves', brand: 'Velour', dial: '94.7', genres: ['r&b', 'soul', 'funk'] },
  { id: 'strobe', key: 'dance floor', brand: 'Strobe', dial: '88.3', genres: ['dance', 'electro', 'house', 'techno', 'trance'] },
  { id: 'anvil', key: 'metal mayhem', brand: 'Anvil', dial: '96.2', genres: ['metal'] },
  { id: 'pin', key: 'punk rocks', brand: 'Pin', dial: '90.9', genres: ['punk'] },
  { id: 'bedsit', key: 'alt tracks', brand: 'Bedsit', dial: '91.7', genres: ['indie', 'alternative'] },
  { id: 'watt', key: 'rock box', brand: 'Watt', dial: '98.4', genres: ['rock'] },
  { id: 'gloss', key: 'pop videos', brand: 'Gloss', dial: '100.1', genres: ['pop'] },
  { id: 'dusty', key: 'country roads', brand: 'Dusty', dial: '87.9', genres: ['country'] },
  { id: 'cadence', key: 'jazz lounge', brand: 'Cadence', dial: '103.2', genres: ['jazz'] },
  { id: 'smokestack', key: 'blues cafe', brand: 'Smokestack', dial: '89.5', genres: ['blues'] },
  { id: 'kindling', key: 'classical hall', brand: 'Kindling', dial: '90.3', genres: ['classical'] },
  { id: 'tidepool', key: 'island vibes', brand: 'Tidepool', dial: '95.8', genres: ['reggae'] },
  { id: 'moonshine', key: 'folk fire', brand: 'Moonshine', dial: '93.6', genres: ['folk'] },
  { id: 'score', key: 'screen scores', brand: 'Score', dial: '97.5', genres: ['soundtrack'] },
  { id: 'caliente', key: 'latin heat', brand: 'Caliente', dial: '99.1', genres: ['latin'] },
  { id: 'hallyu', key: 'k-pop zone', brand: 'Hallyu', dial: '101.8', genres: ['k-pop'] },
];

function musicGenreName(kind, genre) {
  const g = genre.toLowerCase();
  const hit = MUSIC_FAMILIES.find((f) => f.genres.some((k) => g === k || g.includes(k)));
  if (!hit) return null;
  return { network: hit.id, name: kind === 'music' ? hit.brand : `${hit.brand} ${hit.dial}` };
}

// An era is its own identity, the way a classics channel is not "the old-film network of a brand".
// A null is a medium that has no channel for that era - a 1960s music video - so the item keeps the
// genre station it is already on instead of being filed under a name nobody chose.
const ERAS = [
  { from: 0, id: 'nitrate', movie: 'Nitrate', music: 'Shellac', radio: 'Wireless' },
  { from: 1960, id: 'pop-art', movie: 'Pop Art', music: null, radio: null },
  { from: 1970, id: 'grain', movie: 'Grain', music: 'Glitter', radio: 'AM Gold' },
  { from: 1980, id: 'neon', movie: 'Neon', music: 'VHS', radio: 'Cassingle' },
  { from: 1990, id: 'rental', movie: 'Rental', music: 'Dial-Up', radio: 'Minidisc' },
  { from: 2000, id: 'millennium', movie: 'Millennium', music: 'Ringtone', radio: 'MP3' },
  { from: 2010, id: 'widescreen', movie: 'Widescreen', music: 'Feed', radio: 'Streamline' },
  { from: 2020, id: 'now', movie: 'Now', music: 'Loop', radio: 'Airwave' },
];
/** The era a release belongs to, or null when its medium has no channel for that era. */
function decadeName(d, kind = 'movie') {
  let row = ERAS[0];
  for (const e of ERAS) if (d >= e.from) row = e;
  const name = kind === 'music' || kind === 'radio' ? row[kind] : row.movie;
  return name ? { network: row.id, name } : null;
}

// Where an item lands when nothing on the roster reached its threshold: one brand per medium, so an
// unplaceable film is still watchable and never ends up carrying a product name.
const CATCH_ALL = {
  tv: { network: 'the-spare', name: 'The Spare' },
  movie: { network: 'backlot', name: 'Backlot' },
  music: { network: 'the-b-side', name: 'The B-Side' },
  radio: { network: 'frequency', name: 'Frequency' },
};


const STUDIO_ALIASES = [
  [/^bbc[\s-]*(1|one)$/i, 'BBC One'], [/^bbc[\s-]*(2|two)$/i, 'BBC Two'], [/^bbc[\s-]*(3|three)$/i, 'BBC Three'],
  [/^bbc[\s-]*(4|four)$/i, 'BBC Four'], [/^itv[\s-]*1?$/i, 'ITV1'], [/^itv[\s-]*2$/i, 'ITV2'],
  [/^channel[\s-]*(4|four)$/i, 'Channel 4'], [/^channel[\s-]*(5|five)$/i, 'Channel 5'], [/^e4$/i, 'E4'],
];
function normStudio(raw) {
  const s = raw.trim().replace(/\s+/g, ' ');
  for (const [re, name] of STUDIO_ALIASES) if (re.test(s)) return { norm: name.toLowerCase(), name };
  const norm = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return { norm: norm || s.toLowerCase(), name: s };
}
const normGenre = (g) => g.toLowerCase().trim();
/** Sub-genres fold into their station, so Indie Rock, Hard Rock and Rock are one station; anything unrecognised keeps its own name. */
function radioFamily(g) {
  const l = g.toLowerCase();
  const hit = MUSIC_FAMILIES.find((f) => f.genres.some((k) => l === k || l.includes(k)));
  return hit ? hit.key : normGenre(g);
}
const TAGS = /\s*[\(\[-]\s*(\d{4}\s+)?(digital\s+)?(re-?master(ed)?|mono|stereo|deluxe|bonus track|single version|album version|radio edit)[^)\]]*[\)\]]?\s*$/i;
/** artist + title with the "(2011 Remaster)" style tags removed, so one song on many releases gets one key. A live version or a remix stays distinct. */
export function songKey(artist, title) {
  const t = String(title || '').replace(TAGS, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const a = String(artist || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return t ? `${a}|${t}` : '';
}

// Well-known UK ordering, used to hand out channel numbers where the name matches.
const PREFERRED_NUMBERS = [[/^bbc one$/i, 1], [/^bbc two$/i, 2], [/^itv1$/i, 3], [/^channel 4$/i, 4], [/^channel 5$/i, 5],
  [/^itv2$/i, 6], [/^bbc three$/i, 7], [/^bbc four$/i, 9], [/^e4$/i, 10]];

// ---- inference ----------------------------------------------------------

/**
 * Decide which channels every item belongs to (an item can be on several) and store that in channel_items.
 *  TV:     one channel per studio tag; shows with no qualifying studio fall back to genre channels
 *          (or every show gets genre channels if tvGenreChannelsForAll is on).
 *  Movies: genre channels, plus (optionally) studio channels and decade channels.
 *  Anything left over lands in a catch-all channel.
 */
/**
 * What a spoken-word item belongs to. Podcasts and radio series: the show's folder (the first folder under the library), because the album tag is
 * often a season ("Show - Season 2") and would split one show over many channels. Audiobooks: the book (album tag), else its folder.
 */
export function talkTitle({ path: p, lib_path: base, lib_type: type, album }) {
  const slash = (x) => String(x).replace(/\\/g, '/');
  const root = base ? slash(base).replace(/\/$/, '') + '/' : '';
  const rel = root && p && slash(p).startsWith(root) ? slash(p).slice(root.length) : ''; // a path not under the library (should not happen) has no show folder
  const parts = rel.split('/').filter(Boolean);
  const folder = parts.length > 1 ? parts[0] : '';
  if (type === 'talk_podcasts') return folder || album || '';
  return album || folder || '';
}

/** Spoken-word libraries: one channel per show / book (true), or one station for the whole library (false). Podcasts default to per show. */
export function talkPerTitle(db, libId, libType) {
  const v = db.prepare('SELECT value FROM settings WHERE key=?').get(`talk_per_title_${libId}`)?.value;
  return v === '1' ? true : v === '0' ? false : libType === 'talk_podcasts';
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

export function inferChannels(db) {
  const st = getSettings(db);
  const minSec = st.minChannelMinutes * 60;
  // fitSetting validates one key at a time, so a pair set the wrong way round reaches here intact: read it low-to-high, or the window is empty
  const trackMin = Math.min(st.minTrackSeconds, st.maxTrackSeconds);
  const trackMax = Math.max(st.minTrackSeconds, st.maxTrackSeconds);

  const rows = db.prepare(`
    SELECT i.id, i.kind, i.title AS i_title, i.show_id, i.year, i.runtime, i.studios, i.genres, i.artist, i.album, i.path, i.library_id, l.name AS lib_name, l.type AS lib_type, l.path AS lib_path, l.channel_group AS grp, l.group_mode AS gmode,
      s.studios AS s_studios, s.genres AS s_genres
    FROM items i LEFT JOIN shows s ON s.id = i.show_id LEFT JOIN libraries l ON l.id = i.library_id WHERE i.runtime > 0 AND (i.kind <> 'track' OR i.runtime BETWEEN ? AND ?) ORDER BY i.year IS NULL, i.year, i.id`).all(trackMin, trackMax); // radio: no clips of a few seconds, no hour-long mixes (both adjustable); the oldest release of a song comes first

  // A "unit" is a whole show (all its episodes stay together) or a single movie.
  const units = new Map();
  const idGrp = new Map(); // item id -> its library's channel group
  const songs = new Set(); // the same song on several releases (album, single, greatest hits, remaster) is played once
  for (const r of rows) {
    if (r.kind === 'track') {
      const k = songKey(r.artist, r.i_title);
      if (k) { if (songs.has(k)) continue; songs.add(k); }
    }
    const solo = r.kind === 'movie' || r.kind === 'musicvideo' || r.kind === 'track' || r.kind === 'talk' || r.kind === 'clip';
    const key = solo ? `m${r.id}` : `s${r.show_id}`;
    const ukind = r.kind === 'movie' ? 'movie' : r.kind === 'musicvideo' ? 'music' : r.kind === 'track' ? 'radio' : r.kind === 'talk' ? 'talk' : r.kind === 'clip' ? 'clip' : 'tv';
    let u = units.get(key);
    if (!u) {
      u = { kind: ukind, ids: [], seconds: 0, year: r.year, studios: new Map(), genres: new Map(), lib: r.library_id, libName: r.lib_name, libType: r.lib_type, album: r.album, title: talkTitle(r),
        grp: String(r.grp || '').trim(), mode: ukind === 'clip' ? 'single' : (r.gmode || 'inferred') }; // clips and interviews are only ever a channel of their own
      units.set(key, u);
    }
    u.ids.push(r.id); u.seconds += r.runtime;
    if (r.grp && String(r.grp).trim() && (r.kind === 'clip' || r.gmode === 'single' || r.gmode === 'both')) idGrp.set(r.id, String(r.grp).trim()); // only a real channel group makes a chip; a label on an ordinary library does not
    const studios = [...JSON.parse(r.s_studios || '[]'), ...JSON.parse(r.studios || '[]')];
    const genres = [...JSON.parse(r.s_genres || '[]'), ...JSON.parse(r.genres || '[]')];
    for (const s of new Set(studios)) { const n = normStudio(s); if (!u.studios.has(n.norm)) u.studios.set(n.norm, n); }
    for (const g of new Set(genres)) { const n = u.kind === 'radio' ? radioFamily(g) : normGenre(g); if (n) u.genres.set(n, g); } // radio: Indie Rock, Hard Rock and Rock are one Rock station
  }

  // popularity of each tag (total seconds, and film counts for movie studios)
  const secs = { tv: { studio: new Map(), genre: new Map() }, movie: { genre: new Map(), studio: new Map(), decade: new Map() },
    music: { genre: new Map(), decade: new Map() }, radio: { genre: new Map(), decade: new Map() } };
  const films = new Map();
  const bump = (m, k, n) => m.set(k, (m.get(k) || 0) + n);
  for (const u of units.values()) {
    if (u.kind === 'talk' || u.kind === 'clip' || u.mode === 'single') continue; // those get a channel of their own, not genre / decade / studio channels
    if (u.kind === 'tv') for (const k of u.studios.keys()) bump(secs.tv.studio, k, u.seconds);
    for (const k of u.genres.keys()) bump(secs[u.kind].genre, k, u.seconds);
    if (u.kind === 'music' || u.kind === 'radio') { if (u.year) bump(secs[u.kind].decade, Math.floor(u.year / 10) * 10, u.seconds); }
    if (u.kind === 'movie') {
      for (const k of u.studios.keys()) bump(films, k, 1);
      if (u.year) bump(secs.movie.decade, Math.floor(u.year / 10) * 10, u.seconds);
    }
  }

  const assign = new Map(); // channel key -> { kind, name, network, ids:Set }
  const put = (key, kind, name, ids, network = null) => {
    const c = assign.get(key) || { kind, name, network, ids: new Set() };
    if (c.kind !== kind && key.startsWith('group:') && !['music', 'clips'].includes(c.kind) && !['music', 'clips'].includes(kind)) c.kind = 'tv'; // films and shows in one group: scheduled as TV
    for (const id of ids) c.ids.add(id);
    assign.set(key, c);
  };

  for (const u of units.values()) {
    let placed = false;
    // a channel group: libraries that share a group name become one channel ("Stand Up" = Stand Up Films + Stand Up Shows, Managed + Unmanaged)
    const gname = u.kind === 'talk' ? '' : (u.grp || (u.mode === 'single' ? String(u.libName || '').trim() : ''));
    if (gname && (u.mode === 'single' || u.mode === 'both')) put(`group:${slug(gname)}`, u.kind === 'movie' ? 'movie' : u.kind === 'tv' ? 'tv' : u.kind === 'clip' ? 'clips' : 'music', gname, u.ids);
    if (u.mode === 'single' && u.kind !== 'talk') continue;
    if (u.kind === 'talk') {
      // one channel per show / book when the library is set that way (the default for podcasts), always playing in order and looping;
      // otherwise one station per spoken-word library, named after the library
      const title = String(u.title || '').trim();
      if (title && talkPerTitle(db, u.lib, u.libType)) { put(`radio:talk:${u.lib}:${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)}`, 'radio', title, u.ids); continue; }
      put(`radio:talk:${u.lib}`, 'radio', (u.libName || '').trim() || TALK[u.libType]?.channel || 'Talk Radio', u.ids);
      continue;
    }
    if (u.kind === 'tv') {
      for (const [k, n] of u.studios) {
        if ((secs.tv.studio.get(k) || 0) >= minSec) { put(`tv:studio:${k}`, 'tv', n.name, u.ids); placed = true; }
      }
      if (st.tvGenreChannelsForAll || !placed) {
        for (const [k, name] of u.genres) {
          const ch = genreChannelName('tv', name);
          if (ch && (secs.tv.genre.get(k) || 0) >= minSec) { put(`tv:genre:${k}`, 'tv', ch.name, u.ids, ch.network); placed = true; }
        }
      }
      if (!placed) put('tv:misc', 'tv', CATCH_ALL.tv.name, u.ids, CATCH_ALL.tv.network);
    } else if (u.kind === 'music' || u.kind === 'radio') {
      for (const [k, name] of u.genres) {
        const ch = musicGenreName(u.kind, name);
        if (ch && (secs[u.kind].genre.get(k) || 0) >= minSec) { put(`${u.kind}:genre:${k}`, u.kind, ch.name, u.ids, ch.network); placed = true; }
      }
      if (u.year) {
        const d = Math.floor(u.year / 10) * 10;
        const key = d < 1960 ? `${u.kind}:decade:oldies` : `${u.kind}:decade:${d}`;
        const era = decadeName(d, u.kind);
        if (era && ((secs[u.kind].decade.get(d) || 0) >= minSec || d < 1960)) { put(key, u.kind, era.name, u.ids, era.network); placed = true; }
      }
      if (!placed) put(`${u.kind}:misc`, u.kind, CATCH_ALL[u.kind].name, u.ids, CATCH_ALL[u.kind].network);
    } else {
      for (const [k, name] of u.genres) {
        const ch = genreChannelName('movie', name);
        if (ch && (secs.movie.genre.get(k) || 0) >= minSec) { put(`movie:genre:${k}`, 'movie', ch.name, u.ids, ch.network); placed = true; }
      }
      if (st.movieStudioChannels) {
        for (const [k, n] of u.studios) {
          if ((films.get(k) || 0) >= st.movieStudioMinFilms) { put(`movie:studio:${k}`, 'movie', n.name, u.ids); placed = true; }
        }
      }
      if (st.movieDecadeChannels && u.year) {
        const d = Math.floor(u.year / 10) * 10;
        const key = d < 1960 ? 'movie:decade:classic' : `movie:decade:${d}`;
        const era = decadeName(d, 'movie');
        if (era && ((secs.movie.decade.get(d) || 0) >= minSec || d < 1960)) { put(key, 'movie', era.name, u.ids, era.network); placed = true; }
      }
      if (!placed) put('movie:misc', 'movie', CATCH_ALL.movie.name, u.ids, CATCH_ALL.movie.network);
    }
  }

  // Different genres can share one themed name (every kind of "jazz" is "Jazz FM"). Keep each channel and its number, but tell them apart:
  // the plainest genre (shortest name, then by key so it is stable) keeps the plain name, the others say which genre they are.
  const genreOf = (key) => /:genre:(.+)$/.exec(key)?.[1] || '';
  const sameName = new Map();
  for (const [key, c] of assign.entries()) {
    const k = `${c.kind}|${c.name.toLowerCase()}`;
    if (!sameName.has(k)) sameName.set(k, []);
    sameName.get(k).push([key, c]);
  }
  for (const group of sameName.values()) {
    if (group.length < 2) continue;
    group.sort(([ka], [kb]) => genreOf(ka).length - genreOf(kb).length || ka.localeCompare(kb));
    group.slice(1).forEach(([key, c]) => { const g = genreOf(key); if (g) c.name += ` (${title(g)})`; });
  }

  // a movie studio that shares its name with a TV channel gets a suffix so they stay distinguishable
  const tvNames = new Set([...assign.values()].filter((c) => c.kind === 'tv').map((c) => c.name.toLowerCase()));
  for (const c of assign.values()) if (c.kind === 'movie' && tvNames.has(c.name.toLowerCase())) c.name += ' Movies';

  tx(db, () => {
    const existing = new Map(db.prepare('SELECT * FROM channels').all().map((c) => [c.key, c]));
    const taken = new Set([...existing.values()].map((c) => c.number).filter((n) => n != null));
    let nextNum = Math.max(10, ...[...taken].filter((n) => n < 300), 0) + 1;
    const BASE = { music: 400, live: 600, radio: 800 };
    const freeFrom = (n) => { while (taken.has(n)) n++; return n; };
    const ins = db.prepare('INSERT INTO channels(key,kind,auto_name,number,enabled,item_count,network) VALUES(?,?,?,?,1,0,?)');
    const upd = db.prepare('UPDATE channels SET auto_name=?, item_count=?, kind=?, grp=?, network=? WHERE id=?'); // kind too: a group of films and shows is TV, whatever its first library was
    db.exec('DELETE FROM channel_items');
    const link = db.prepare('INSERT OR IGNORE INTO channel_items(channel_id,item_id) VALUES(?,?)');

    const order = [...assign.entries()].sort(([ka, a], [kb, b]) =>
      (a.kind === b.kind ? 0 : a.kind === 'tv' ? -1 : 1) || ka.localeCompare(kb));
    for (const [key, c] of order) {
      let ch = existing.get(key);
      if (!ch) {
        let num = null;
        for (const [re, n] of PREFERRED_NUMBERS) if (re.test(c.name) && !taken.has(n)) num = n;
        if (num == null) { if (BASE[c.kind]) num = freeFrom(BASE[c.kind]); else { nextNum = freeFrom(nextNum); num = nextNum++; } }
        taken.add(num);
        ch = { id: Number(ins.run(key, c.kind, c.name, num, c.network).lastInsertRowid) };
      }
      const gc = new Map(); for (const id of c.ids) { const g = idGrp.get(id); if (g) gc.set(g, (gc.get(g) || 0) + 1); }
      const top = [...gc.entries()].sort((a, b) => b[1] - a[1])[0]; // the group most of its programmes belong to
      upd.run(c.name, c.ids.size, c.kind, top && top[1] * 2 >= c.ids.size ? top[0] : null, c.network, ch.id);
      for (const id of c.ids) link.run(ch.id, id);
    }
    for (const [key, ch] of existing) if (!assign.has(key) && !key.startsWith('live:')) upd.run(ch.auto_name, 0, ch.kind, null, ch.network, ch.id); // emptied channels (live ones: syncLiveChannels)
  });
}

/**
 * One channel per live stream (IPTV entries, single HLS streams, YouTube live). They have no schedule, so item_count is just
 * 1 (on air) or 0 (the health check found it dead). Big playlists start switched off, then the first working ones are enabled.
 */
export function syncLiveChannels(db) {
  const CAP = 80;
  const streams = db.prepare('SELECT s.*, (SELECT COUNT(*) FROM live_streams x WHERE x.library_id=s.library_id) AS total FROM live_streams s ORDER BY s.library_id, s.grp, s.name').all();
  tx(db, () => {
    const existing = new Map(db.prepare("SELECT * FROM channels WHERE key LIKE 'live:%'").all().map((c) => [c.key, c]));
    const taken = new Set(db.prepare('SELECT number FROM channels WHERE number IS NOT NULL').all().map((r) => r.number));
    const ins = db.prepare("INSERT INTO channels(key,kind,auto_name,number,enabled,item_count) VALUES(?,'live',?,?,?,?)");
    const upd = db.prepare('UPDATE channels SET auto_name=?, item_count=? WHERE id=?');
    const link = db.prepare('UPDATE live_streams SET channel_id=? WHERE id=?');
    const aliveIds = new Map();
    let n = 600;
    for (const st of streams) {
      const key = `live:${st.id}`;
      const count = st.alive === 0 ? 0 : 1;
      let ch = existing.get(key);
      if (!ch) {
        while (taken.has(n)) n++;
        taken.add(n);
        ch = { id: Number(ins.run(key, st.name, n, st.total <= CAP ? 1 : 0, count).lastInsertRowid) };
      } else upd.run(st.name, count, ch.id);
      link.run(ch.id, st.id);
      if (st.alive === 1) aliveIds.set(st.library_id, [...(aliveIds.get(st.library_id) || []), ch.id]);
    }
    const flag = db.prepare('SELECT 1 FROM settings WHERE key=?');
    for (const [lib, ids] of aliveIds) {
      const total = streams.find((x) => x.library_id === lib)?.total || 0;
      if (total <= CAP || flag.get(`live_autoenabled_${lib}`) || streams.some((x) => x.library_id === lib && x.alive == null)) continue;
      for (const id of ids.slice(0, CAP)) db.prepare('UPDATE channels SET enabled=1 WHERE id=?').run(id);
      db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run(`live_autoenabled_${lib}`, '1');
    }
    const keep = new Set(streams.map((x) => `live:${x.id}`));
    // channels whose stream is gone (its playlist was removed or refreshed without it) are deleted, not just hidden: otherwise they pile up
    // in Setup > Channels and keep their channel numbers for ever
    for (const [key, ch] of existing) if (!keep.has(key)) db.prepare('DELETE FROM channels WHERE id=?').run(ch.id);
  });
}

/**
 * Give a channel a guide number, or refuse it.
 *
 * Two channels cannot share a number, and the channel already holding it is not the one being edited.
 * The route used to clear the other row's number first ("last write wins"), which silently moved a
 * channel the user had not touched - and in a guide sorted by number, moved it for every viewer. The
 * caller answers 409 and names the holder, so the choice is visible instead of performed.
 */
export function setChannelNumber(db, id, number) {
  const held = db.prepare('SELECT id, COALESCE(name_override, auto_name) AS name FROM channels WHERE number=? AND id<>?').get(number, id);
  if (held) return { ok: false, held };
  db.prepare('UPDATE channels SET number=? WHERE id=?').run(number, id);
  return { ok: true, held: null };
}
