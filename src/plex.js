// Plex as a source of TV and films, beside Jellyfin / Emby (they share one API) and Navidrome.
// Items are stored as  ms://<sourceId>/<part key>  and turned into a playable URL only at the moment ffmpeg needs it,
// so the account token is never kept in an item path and never sent to the browser.
//
// Plex differs from Jellyfin in three ways that matter here:
//  - the token travels as an X-Plex-Token header (so this module owns its own request helper),
//  - durations are milliseconds, and the Part key is a path ("/library/parts/141/1699999999/file.mkv"),
//  - the API answers JSON when asked, so no XML parser is needed.
// The Part key is what gets stored: playback then costs no API call at all, which matters because resolveMedia()
// runs inside the broadcaster at the moment a programme starts.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { cfg } from './config.js';
import { tx } from './db.js';

const arr = (x) => (Array.isArray(x) ? x : x ? [x] : []);
const covers = () => path.join(cfg.configDir, 'covers');
const coverFile = (srcId, id) => path.join(covers(), `plex_${srcId}_${String(id).replace(/[^\w-]/g, '')}.jpg`);
/** A short signature of the metadata, so a scan can tell an edited item from an unchanged one without keeping it all. */
const sig = (o) => parseInt(crypto.createHash('md5').update(JSON.stringify(o)).digest('hex').slice(0, 7), 16);

const HEADERS = (src) => ({
  'X-Plex-Token': src.token || '',
  'X-Plex-Client-Identifier': 'wbtv',
  'X-Plex-Product': 'WBTV',
  'X-Plex-Version': '1',
});

/**
 * One request to a Plex server. `doFetch` is injected so the tests can answer without a server.
 * 401/403 is the token; everything else is the address or the network, and the messages say which.
 */
export async function plexGet(src, pathAndQuery, { doFetch = fetch, headers = {}, timeout = 30000, binary = false } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await doFetch(`${src.url}${pathAndQuery}`, {
      headers: { ...HEADERS(src), Accept: binary ? '*/*' : 'application/json', ...headers },
      signal: ctl.signal,
    });
    if (r.status === 401 || r.status === 403) throw new Error('the server rejected the token');
    if (!r.ok) throw new Error(`the server answered ${r.status}`);
    return binary ? Buffer.from(await r.arrayBuffer()) : r.json();
  } catch (e) {
    if (e?.message === 'the server rejected the token' || /^the server answered \d+$/.test(e?.message || '')) throw e;
    if (e?.name === 'AbortError') throw new Error('the server did not answer in time');
    throw new Error(`could not reach ${src.url} (${e?.cause?.code || e?.message || e})`);
  } finally { clearTimeout(t); }
}

/** What ffmpeg should read for a stored item path: ms://<sourceId>/<part key> -> the part's URL, token in the query. */
export const plexPartUrl = (src, ref) =>
  `${src.url}/library/parts/${String(ref).split('/').map(encodeURIComponent).join('/')}?X-Plex-Token=${encodeURIComponent(src.token || '')}`;

/** "/library/parts/141/1699999999/file.mkv" -> "141/1699999999/file.mkv"; null when Plex did not give one. */
export function partRef(part) {
  const m = /^\/library\/parts\/(.+)$/.exec(String(part?.key || ''));
  if (m) return m[1];
  if (part?.id && part?.file) return `${part.id}/${path.basename(String(part.file))}`; // no key: the documented shape, rebuilt
  return null;
}

const SECTION_TYPE = { movie: 'movies', show: 'tv', artist: 'radio' };

/**
 * Check a server and its token; returns what can be added. `views` has the same shape as the Jellyfin answer
 * ({id, name, type}), so Setup needs no Plex branch: only film and TV sections are offered, and a server with
 * neither says so instead of showing sections that cannot be added.
 */
export async function discoverPlex(url, token, { doFetch = fetch } = {}) {
  const src = { url, token: String(token || '').trim(), kind: 'plex' };
  if (!src.url) throw new Error('enter the server address, for example 192.168.1.111:32400');
  if (!src.token) throw new Error('enter a Plex token (Plex: Account settings, or the X-Plex-Token in any media URL)');
  const who = (await plexGet(src, '/', { doFetch }))?.MediaContainer || {};
  const all = arr((await plexGet(src, '/library/sections', { doFetch }))?.MediaContainer?.Directory);
  if (!all.length) throw new Error('the server has no libraries');
  const views = all
    .filter((d) => SECTION_TYPE[d.type] === 'movies' || SECTION_TYPE[d.type] === 'tv')
    .map((d) => ({ id: String(d.key), name: d.title || '', type: SECTION_TYPE[d.type] }));
  if (!views.length) throw new Error('this Plex server has no film or TV libraries (music sections are not supported yet)');
  return {
    kind: 'plex', url: src.url,
    name: who.friendlyName || 'Plex', product: 'Plex', version: who.version || '',
    userId: who.machineIdentifier || null, views,
  };
}

const PAGE = 500;

/** Every item in a section, 500 at a time, until Plex says we have them all. */
async function pages(src, query, doFetch) {
  const out = [];
  for (let start = 0; ; start += PAGE) {
    const q = `${query}${query.includes('?') ? '&' : '?'}X-Plex-Container-Start=${start}&X-Plex-Container-Size=${PAGE}`;
    const mc = (await plexGet(src, q, { doFetch, timeout: 90000 }))?.MediaContainer || {};
    const items = arr(mc.Metadata || mc.Video);
    out.push(...items);
    // totalSize is the truth; without it, a short page is the end
    const total = Number(mc.totalSize ?? mc.size ?? 0);
    if (!items.length || (total ? out.length >= total : items.length < PAGE)) break;
  }
  return out;
}

const genresOf = (it) => arr(it.Genre).map((g) => g.tag).filter(Boolean);
const rolesOf = (it) => arr(it.Role).map((r) => ({ name: r.tag || '', role: r.role || '' })).filter((r) => r.name).slice(0, 15);
const jsonArr = (a) => JSON.stringify(a || []);

/**
 * Scan one Plex section into shows and items. Throws — leaving everything exactly as it was — when the server cannot
 * be read, so a server that is switched off never looks like a library that was emptied.
 */
export async function scanPlex(db, lib, src, sectionKey, progress = {}, { safeRemovals, fetch: doFetch = fetch } = {}) {
  const tv = lib.type === 'tv';
  const all = await pages(src, `/library/sections/${encodeURIComponent(sectionKey)}/all`, doFetch);
  const items = all.filter((it) => (tv ? it.type === 'episode' : it.type === 'movie'));
  progress.files = items.length;

  const existing = new Map(db.prepare('SELECT path,mtime,size FROM items WHERE library_id=?').all(lib.id).map((r) => [r.path, r]));
  const showIds = new Map();
  const selShow = db.prepare('SELECT id FROM shows WHERE path=?');
  const insShow = db.prepare('INSERT INTO shows(library_id,path,title,plot,year,rating,mpaa,studios,genres,poster) VALUES(?,?,?,?,?,?,?,?,?,?)');
  const updShow = db.prepare('UPDATE shows SET title=?,plot=?,year=?,rating=?,mpaa=?,studios=?,genres=?,poster=? WHERE id=?');
  const want = []; // art still to download, as show:<id> or item:<id>

  // A show row comes from its episodes: Plex puts the series title and year on every episode, so the series itself
  // never has to be listed (one request fewer, and it works for a library Plex is still scanning).
  if (tv) {
    const shows = new Map();
    for (const ep of items) {
      const key = String(ep.grandparentRatingKey || '');
      if (key && !shows.has(key)) shows.set(key, ep);
    }
    tx(db, () => {
      for (const [key, ep] of shows) {
        const p = `ms://${src.id}/show/${key}`; // never an item path: a show has no stream of its own
        const row = [ep.grandparentTitle || '', '', ep.grandparentYear ?? null, null, '', '[]', '[]', null];
        const ex = selShow.get(p);
        if (ex) { updShow.run(...row, ex.id); showIds.set(key, ex.id); }
        else { showIds.set(key, Number(insShow.run(lib.id, p, ...row).lastInsertRowid)); progress.changed = (progress.changed || 0) + 1; }
        if (ep.grandparentThumb) want.push({ ns: 'show', id: key, thumb: ep.grandparentThumb, path: p });
      }
    });
  }

  const seen = new Set();
  const upsert = db.prepare(`INSERT INTO items
    (library_id,show_id,kind,path,title,plot,year,season,episode,aired,rating,mpaa,runtime,probed,studios,genres,actors,poster,mtime,size,nfo_mtime,artist,album)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?,NULL,?,?)
    ON CONFLICT(path) DO UPDATE SET show_id=excluded.show_id,kind=excluded.kind,title=excluded.title,plot=excluded.plot,year=excluded.year,
      season=excluded.season,episode=excluded.episode,aired=excluded.aired,rating=excluded.rating,mpaa=excluded.mpaa,runtime=excluded.runtime,
      probed=1,studios=excluded.studios,genres=excluded.genres,actors=excluded.actors,poster=excluded.poster,mtime=excluded.mtime,size=excluded.size`);
  const setPoster = db.prepare('UPDATE items SET poster=? WHERE path=?');

  tx(db, () => {
    for (const it of items) {
      const ref = partRef(arr(arr(it.Media)[0]?.Part)[0]);
      const runtime = Math.round(Number(it.duration) / 1000) || 0;
      if (!ref || !(runtime > 0)) continue; // nothing to play, or nothing to schedule
      const p = `ms://${src.id}/${ref}`;
      seen.add(p);
      const show = tv ? showIds.get(String(it.grandparentRatingKey || '')) ?? null : null;
      if (tv && show == null) continue; // an episode whose series could not be read
      const meta = {
        title: it.title || '', plot: it.summary || '', year: it.year ?? null,
        season: tv ? it.parentIndex ?? null : null, episode: tv ? it.index ?? null : null,
        aired: String(it.originallyAvailableAt || '').slice(0, 10) || null,
        rating: it.audienceRating ?? it.rating ?? null, mpaa: it.contentRating || '',
        studios: it.studio ? [it.studio] : [], genres: genresOf(it), actors: rolesOf(it),
      };
      const size = sig([meta, runtime]);
      const mtime = Number(it.updatedAt) || Number(it.addedAt) || 0;
      const ex = existing.get(p);
      const art = coverFile(src.id, it.ratingKey);
      const hasArt = fs.existsSync(art);
      if (!hasArt && it.thumb) want.push({ ns: 'item', id: it.ratingKey, thumb: it.thumb, path: p });
      if (ex && ex.mtime === mtime && ex.size === size) { if (hasArt) setPoster.run(art, p); continue; } // unchanged since the last scan
      progress.changed = (progress.changed || 0) + 1;
      upsert.run(lib.id, show, tv ? 'episode' : 'movie', p, meta.title, meta.plot, meta.year, meta.season, meta.episode, meta.aired,
        meta.rating, meta.mpaa, runtime, jsonArr(meta.studios), jsonArr(meta.genres), JSON.stringify(meta.actors), hasArt ? art : null, mtime, size, null, null);
    }
  });

  // A section that returns nothing (or a page that stopped early) is not evidence of deletion: the same two-scan rule
  // that protects an offline NFS share protects a Plex server that is rebooting.
  const gone = safeRemovals(db, lib, [...existing.keys()].filter((p) => !seen.has(p)), existing.size, seen.size, []);
  if (gone.length) {
    const del = db.prepare('DELETE FROM items WHERE path=?');
    tx(db, () => { for (const p of gone) del.run(p); });
    progress.removed = (progress.removed || 0) + gone.length;
  }
  db.prepare('DELETE FROM shows WHERE library_id=? AND id NOT IN (SELECT DISTINCT show_id FROM items WHERE show_id IS NOT NULL)').run(lib.id);
  db.prepare('UPDATE libraries SET last_scan=? WHERE id=?').run(Date.now(), lib.id);
  await fetchArt(db, src, lib, want, doFetch);
}

/** Pictures, downloaded once into the config folder — bounded per scan, so a big library fills in over a few scans. */
async function fetchArt(db, src, lib, want, doFetch, max = 300) {
  const todo = want.slice(0, max);
  if (!todo.length) return;
  fs.mkdirSync(covers(), { recursive: true });
  const setItem = db.prepare('UPDATE items SET poster=? WHERE path=? AND library_id=?');
  const setShow = db.prepare('UPDATE shows SET poster=? WHERE path=? AND library_id=?');
  let i = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (i < todo.length) {
      const w = todo[i++];
      try {
        const buf = await plexGet(src, String(w.thumb), { doFetch, binary: true, timeout: 20000 });
        if (!buf.length) continue;
        const f = coverFile(src.id, w.id);
        fs.writeFileSync(f, buf);
        (w.ns === 'show' ? setShow : setItem).run(f, w.path, lib.id);
      } catch { /* no picture for this one; tried again on a later scan */ }
    }
  }));
}
