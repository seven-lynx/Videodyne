import fs from 'node:fs';
import path from 'node:path';
import { cfg } from './config.js';
import { run, probe } from './media.js';
import { parseArchiveUrl, resolveItem } from './archive.js';

/**
 * Ads can be added as URLs (YouTube, archive.org/Wayback, direct links...). Two ways in:
 *  - an archive.org item is resolved once (`archive.js`) and then streamed from archive.org as it airs, so nothing is
 *    ever written to disk;
 *  - anything else is downloaded by yt-dlp into /config/ads, so playback only ever touches local files.
 */
let working = false;

export function addAdUrls(db, urls, kind = 'all') {
  if (!['all', 'tv', 'movie'].includes(kind)) kind = 'all';
  const ins = db.prepare("INSERT OR IGNORE INTO ads(title, source, status, kind) VALUES(?, ?, 'pending', ?)");
  const insStreamed = db.prepare("INSERT OR IGNORE INTO ads(title, source, status, kind) VALUES(?, ?, 'resolving', ?)"); // archive.org: streamed, never downloaded
  let added = 0;
  for (const u of urls) {
    const url = u.trim();
    if (!/^https?:\/\//i.test(url)) continue;
    added += Number((parseArchiveUrl(url) ? insStreamed : ins).run(url, url, kind).changes);
  }
  return added;
}

/** An archive.org ad: one metadata read, then the row is ready to air from archive.org itself. */
async function resolveStreamed(db, ad, doFetch) {
  try {
    const a = parseArchiveUrl(ad.source);
    if (!a) throw new Error('not an archive.org address');
    const r = await resolveItem(a.identifier, { prefer: a.file, doFetch });
    db.prepare("UPDATE ads SET status='ready', file=?, title=?, duration=?, error=NULL WHERE id=?").run(r.url, r.title, r.seconds, ad.id);
  } catch (e) {
    db.prepare("UPDATE ads SET status='error', error=? WHERE id=?").run(String(e?.message || e).slice(-300), ad.id);
  }
}

export async function processAds(db, onDone, { doFetch = fetch } = {}) {
  if (working) return;
  working = true;
  try {
    const dir = path.join(cfg.configDir, 'ads');
    fs.mkdirSync(dir, { recursive: true });
    for (;;) {
      const ad = db.prepare("SELECT * FROM ads WHERE status IN ('pending','resolving') AND library_id IS NULL ORDER BY id LIMIT 1").get();
      if (!ad) break;
      if (ad.status === 'resolving') { await resolveStreamed(db, ad, doFetch); continue; }
      db.prepare("UPDATE ads SET status='downloading', error=NULL WHERE id=?").run(ad.id);
      const tmpl = path.join(dir, `${ad.id}.%(ext)s`);
      const r = await run(cfg.ytdlp, ['--no-playlist', '--no-warnings', '--js-runtimes', 'node', '-f', 'bv*[height<=720]+ba/b[height<=720]/b',
        '--merge-output-format', 'mp4', '--no-simulate', '--dump-single-json', '-o', tmpl, ad.source], { timeout: 10 * 60 * 1000 });
      let file = fs.readdirSync(dir).find((f) => f.startsWith(`${ad.id}.`) && !f.endsWith('.part') && !f.endsWith('.json'));
      if (r.code !== 0 || !file) {
        db.prepare("UPDATE ads SET status='error', error=? WHERE id=?").run((r.err || 'download failed').slice(-300), ad.id);
        continue;
      }
      file = path.join(dir, file);
      let title = ad.source;
      try { title = JSON.parse(r.out).title || title; } catch { /* keep url */ }
      const p = await probe(file);
      if (!p) db.prepare("UPDATE ads SET status='error', error='unreadable media' WHERE id=?").run(ad.id);
      else db.prepare("UPDATE ads SET status='ready', file=?, title=?, duration=? WHERE id=?").run(file, title, p.duration, ad.id);
    }
  } finally {
    working = false;
    onDone?.();
  }
}

export function removeAd(db, id) {
  const ad = db.prepare('SELECT * FROM ads WHERE id=?').get(id);
  if (!ad) return;
  if (!ad.library_id && ad.file && !/^https?:\/\//i.test(ad.file)) fs.rm(ad.file, () => {}); // a streamed ad has no file of ours to remove
  db.prepare('UPDATE blocks SET ad_id=NULL WHERE ad_id=?').run(id); // keep the slot; the broadcaster fills it with another ad
  db.prepare('DELETE FROM ads WHERE id=?').run(id);
}
