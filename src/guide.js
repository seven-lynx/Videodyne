// The guide has two ways in — GET /api/epg for a window and GET /api/channels/:id/now for one
// instant — and both describe the same programme, so both answer from one row mapping: a client
// that can render a guide entry can render "what is on now" without fetching the whole guide (#8).
//
// The routes live in a register function rather than in server.js because that file listens at
// import, so this is the only shape a test can drive — the pattern registerIptvOut already uses.
const GUIDE_SELECT = `p.id, p.channel_id AS ch, p.start, p.end, i.id AS item_id, i.kind, i.title, i.plot,
       i.season, i.episode, i.year, i.genres, i.rating, i.mpaa, i.aired, i.artist, i.album, s.title AS show_title,
       c.kind AS channel_kind`;
const GUIDE_FROM = 'FROM programmes p JOIN items i ON i.id=p.item_id JOIN channels c ON c.id=p.channel_id LEFT JOIN shows s ON s.id=i.show_id';

/** Compact guide entry for the TV app: no empty fields, and descriptions only where the app has no other source for them. */
const thin = (o, keepPlot) => {
  const q = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === null || v === '' || v === false || (Array.isArray(v) && !v.length)) continue;
    if (k === 'plot' && !keepPlot) continue;
    q[k] = v;
  }
  return q;
};

/** One programme row as the guide describes it. `tracks` is set for music/radio programmes, whose description is the track list. */
function guideEntry(r, now, tracks) {
  const entry = {
    id: r.id, item: r.item_id, start: r.start, end: r.end, movie: r.kind === 'movie',
    title: r.kind === 'talk' ? r.title : r.show_title || r.title,
    subtitle: r.kind === 'talk' ? [r.album, r.artist && r.artist !== r.album ? r.artist : ''].filter(Boolean).join(' · ') : r.show_title ? r.title : '',
    season: r.season, episode: r.episode, year: r.year, plot: r.plot, rating: r.rating, mpaa: r.mpaa,
    genres: JSON.parse(r.genres || '[]'),
  };
  if (!tracks) return entry;
  // every track of the programme with its time: the guide shows what is playing or still to come (not just the first four of the
  // half hour), and the on-screen banner uses the times to follow the track actually being watched
  const ahead = tracks.filter((x) => x.end > now);
  const t = (ahead.length ? ahead : tracks).slice(0, 4);
  const nm = (x) => (x.artist ? `${x.artist} – ${x.title}` : x.title);
  const near = r.end > now - 3600 && r.start < now + 1800; // only programmes around now need per-track times
  return {
    ...entry, item: t[0] ? t[0].item : r.item_id, title: t[0] ? nm(t[0]) : r.title, subtitle: t.slice(1).map(nm).join(' · '),
    plot: tracks.map(nm).join('\n'), ...(near ? { trk: tracks.map((x) => [Math.round(x.start), Math.round(x.end), nm(x), x.item]) } : {}),
  };
}

export function registerGuide(app, db) {
  const trackRows = db.prepare("SELECT i.id AS item, i.artist, i.title, b.start, b.end FROM blocks b JOIN items i ON i.id=b.item_id WHERE b.programme_id=? AND b.kind='content' ORDER BY b.start");
  const trackChannel = (kind) => kind === 'music' || kind === 'radio';

  app.get('/api/epg', (req) => {
    const slim = req.query.slim === '1';
    const now = Date.now() / 1000;
    const from = Number(req.query.from) || now - 3600;
    const to = Number(req.query.to) || now + 6 * 3600;
    const rows = db.prepare(`SELECT ${GUIDE_SELECT} ${GUIDE_FROM}
      WHERE c.enabled=1 AND p.end > ? AND p.start < ? ORDER BY p.channel_id, p.start`).all(from, to);
    const programmes = {};
    // music / radio guide entries are ~30 minutes of tracks: show the first track and list the next ones
    const tracks = new Map();
    for (const r of rows) if (trackChannel(r.channel_kind) && r.kind !== 'talk') tracks.set(r.id, trackRows.all(r.id));
    for (const r of rows) {
      const entry = guideEntry(r, now, tracks.get(r.id));
      // music/radio entries carry a generated track list as their description; everything else the app fetches per programme
      (programmes[r.ch] ||= []).push(slim ? thin(entry, tracks.has(r.id)) : entry);
    }
    // live channels have no schedule: give them rolling two-hour "live" entries so they sit in the guide like everything else
    const live = db.prepare("SELECT c.id, COALESCE(c.name_override, c.auto_name) AS name, s.grp FROM channels c LEFT JOIN live_streams s ON s.channel_id=c.id WHERE c.kind='live' AND c.enabled=1 AND c.item_count>0").all();
    for (const c of live) {
      const list = [];
      for (let t = Math.floor(from / 7200) * 7200; t < to; t += 7200) {
        const e = { id: -(c.id * 1000 + list.length + 1), item: 0, start: t, end: t + 7200, movie: false, title: c.name, subtitle: c.grp || 'Live', season: null, episode: null,
          year: null, plot: 'Live stream. There is no schedule: you join whatever is on right now.', rating: null, mpaa: '', genres: c.grp ? [c.grp] : [] };
        list.push(slim ? thin(e, true) : e);
      }
      programmes[c.id] = list;
    }
    // closedown periods show up as "Off air" so the guide matches what is on screen
    const off = db.prepare("SELECT b.id, b.channel_id AS ch, b.start, b.end FROM blocks b JOIN channels c ON c.id=b.channel_id WHERE b.kind='signoff' AND c.enabled=1 AND b.end > ? AND b.start < ?").all(from, to);
    for (const b of off) {
      const e = { id: -(5000000 + b.id), item: 0, start: b.start, end: b.end, movie: false, title: 'Off air', subtitle: 'Closedown', season: null, episode: null,
        year: null, plot: 'This channel is closed down for the night.', rating: null, mpaa: '', genres: [] };
      (programmes[b.ch] ||= []).push(slim ? thin(e, true) : e);
    }
    for (const k of Object.keys(programmes)) programmes[k].sort((x, y) => x.start - y.start);
    return { now, from, to, programmes };
  });

  // The same row and the same mapping as a guide entry: the answer to "what is on now" is the object
  // the guide already lists for this instant, not a bare programmes row a client cannot render (#8).
  app.get('/api/channels/:id/now', (req) => {
    const now = Date.now() / 1000;
    const cur = db.prepare(`SELECT ${GUIDE_SELECT} ${GUIDE_FROM}
      WHERE p.channel_id=? AND p.start<=? AND p.end>? LIMIT 1`).get(req.params.id, now, now);
    if (!cur) return { now, programme: null };
    const tracks = trackChannel(cur.channel_kind) && cur.kind !== 'talk' ? trackRows.all(cur.id) : undefined;
    return { now, programme: guideEntry(cur, now, tracks) };
  });
}
