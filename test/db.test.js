import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db.js';

// Every other test builds a database from nothing, so `SCHEMA` and `migrate()` always run against an
// empty file and the union of both is what a test sees. These open a database written before the
// migrations existed, which is the only way to prove `migrate()` still does its job.
//
// The old shape is written by hand, and it has to carry every table `migrate()` touches: an ALTER on
// a table that is not there throws, and SCHEMA's CREATE TABLE IF NOT EXISTS will only fill the gaps.
const OLD_LIBRARIES = `CREATE TABLE libraries (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, type TEXT NOT NULL, last_scan INTEGER
);`;
const OLD_LIBRARIES_CHECKED = `CREATE TABLE libraries (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, type TEXT NOT NULL, last_scan INTEGER,
  CHECK (type IN ('movies','tv','ads'))
);`;
const OLD_TABLES = `
CREATE TABLE channels (
  id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
  auto_name TEXT NOT NULL, name_override TEXT, number INTEGER, enabled INTEGER DEFAULT 1,
  item_count INTEGER DEFAULT 0
);
CREATE TABLE items (
  id INTEGER PRIMARY KEY, library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  show_id INTEGER, kind TEXT NOT NULL, path TEXT NOT NULL UNIQUE, title TEXT, plot TEXT, year INTEGER,
  season INTEGER, episode INTEGER, aired TEXT, rating REAL, mpaa TEXT,
  runtime REAL DEFAULT 0, probed INTEGER DEFAULT 0,
  studios TEXT DEFAULT '[]', genres TEXT DEFAULT '[]', actors TEXT DEFAULT '[]',
  poster TEXT, mtime REAL, size REAL, nfo_mtime REAL, channel_id INTEGER
);
CREATE TABLE blocks (
  id INTEGER PRIMARY KEY, channel_id INTEGER NOT NULL, programme_id INTEGER,
  kind TEXT NOT NULL, item_id INTEGER, ad_id INTEGER,
  in_point REAL NOT NULL DEFAULT 0, start REAL NOT NULL, end REAL NOT NULL
);
CREATE TABLE ads (
  id INTEGER PRIMARY KEY, title TEXT, source TEXT UNIQUE, file TEXT,
  duration REAL DEFAULT 0, status TEXT DEFAULT 'pending', error TEXT,
  library_id INTEGER REFERENCES libraries(id) ON DELETE CASCADE
);
CREATE TABLE sources (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'jellyfin', name TEXT, url TEXT NOT NULL UNIQUE, token TEXT, user_id TEXT
);
CREATE TABLE mv_jobs (
  id INTEGER PRIMARY KEY, imvdb_id TEXT NOT NULL UNIQUE, artist TEXT NOT NULL, title TEXT, year INTEGER,
  status TEXT NOT NULL DEFAULT 'queued', error TEXT, file TEXT, created INTEGER, updated INTEGER
);
`;

/** Write a pre-migration database in `dir` holding one library, one channel and one item. */
function writeOldDb(dir, libraries = OLD_LIBRARIES) {
  fs.mkdirSync(dir, { recursive: true });
  // written under the pre-rename filename on purpose: this fixture is what proves `openDb` renames it
  // in place and keeps the rows (BRAND/B5)
  const db = new DatabaseSync(path.join(dir, 'wbtv.db'));
  db.exec(libraries + OLD_TABLES);
  db.prepare("INSERT INTO libraries(id,name,path,type,last_scan) VALUES(1,'Films','/media/films','movies',0)").run();
  db.prepare("INSERT INTO channels(id,key,kind,auto_name) VALUES(1,'films','movie','Films')").run();
  db.prepare("INSERT INTO items(id,library_id,kind,path,title) VALUES(1,1,'movie','/media/films/a.mkv','A Film')").run();
  db.close();
  return dir;
}

/** Column names of a table; the pragma's argument is bound, not concatenated (SQLite >= 3.16). */
const columns = (db, table) => db.prepare('SELECT name FROM pragma_table_info(?)').all(table).map((c) => c.name);

test('an old database gains the columns only migrate() knows about, and keeps its rows', () => {
  const dir = writeOldDb(fs.mkdtempSync(path.join(os.tmpdir(), 'wbtv-olddb-')));
  const db = openDb(dir);
  try {
    assert.ok(fs.existsSync(path.join(dir, 'videodyne.db')), 'the pre-rename database was renamed on open');
    assert.equal(fs.existsSync(path.join(dir, 'wbtv.db')), false, 'and the old filename is gone');
    assert.ok(columns(db, 'libraries').includes('channel_group'));
    assert.ok(columns(db, 'libraries').includes('group_mode'));
    assert.ok(columns(db, 'channels').includes('grp'));
    assert.ok(columns(db, 'items').includes('artist'));
    assert.ok(columns(db, 'items').includes('album'));
    assert.ok(columns(db, 'blocks').includes('promo_id'));
    assert.ok(columns(db, 'ads').includes('kind'));
    assert.ok(columns(db, 'sources').includes('salt'));
    assert.ok(columns(db, 'mv_jobs').includes('force'));

    const lib = db.prepare('SELECT name,path,group_mode FROM libraries WHERE id=1').get();
    assert.equal(lib.name, 'Films', 'the library survived the migration');
    assert.equal(lib.path, '/media/films');
    assert.equal(lib.group_mode, 'inferred', 'a NOT NULL column added later arrives with its default on an old row');
    assert.equal(db.prepare('SELECT key FROM channels WHERE id=1').get().key, 'films');
    const item = db.prepare('SELECT title,path FROM items WHERE id=1').get();
    assert.equal(item.title, 'A Film');
    assert.equal(item.path, '/media/films/a.mkv');
  } finally {
    db.close();
  }
});

test('a libraries table carrying the old CHECK is rebuilt, and the constraint is gone', () => {
  const dir = writeOldDb(fs.mkdtempSync(path.join(os.tmpdir(), 'wbtv-check-')), OLD_LIBRARIES_CHECKED);
  const db = openDb(dir);
  try {
    const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='libraries'").get().sql;
    assert.equal(/CHECK/i.test(ddl), false, 'the migration drops and renames the table to get rid of the CHECK');
    assert.equal(db.prepare('SELECT type FROM libraries WHERE id=1').get().type, 'movies', 'the row survived DROP and RENAME');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM items').get().n, 1, 'and so did the row that references it');
    db.prepare("UPDATE libraries SET type='radio' WHERE id=1").run();
    assert.equal(db.prepare('SELECT type FROM libraries WHERE id=1').get().type, 'radio', 'a type the old CHECK refused is accepted now');
  } finally {
    db.close();
  }
});

test('opening an already migrated database again changes nothing', () => {
  const dir = writeOldDb(fs.mkdtempSync(path.join(os.tmpdir(), 'wbtv-again-')));
  const counts = (db) => db.prepare('SELECT (SELECT COUNT(*) FROM libraries) AS libraries, (SELECT COUNT(*) FROM channels) AS channels, (SELECT COUNT(*) FROM items) AS items').get();
  const first = openDb(dir);
  const before = counts(first);
  first.close();
  const second = openDb(dir);
  try {
    assert.deepEqual(counts(second), before, 'migrate() is safe to run on every start');
    assert.ok(columns(second, 'libraries').includes('group_mode'));
  } finally {
    second.close();
  }
});

test('a pre-rename database takes its write-ahead sidecars with it', () => {
  const dir = writeOldDb(fs.mkdtempSync(path.join(os.tmpdir(), 'wbtv-sidecar-')));
  // A zero-length WAL is the legal "nothing pending" state and the only sidecar a test can fake without
  // inventing pages SQLite would try to replay. If the rename moved the database alone, the old `-wal`
  // would be left behind and the next real transaction on this install would replay into nothing.
  fs.writeFileSync(path.join(dir, 'wbtv.db-wal'), '');
  const db = openDb(dir);
  try {
    assert.ok(fs.existsSync(path.join(dir, 'videodyne.db-wal')), 'the sidecar followed the database');
    assert.equal(fs.existsSync(path.join(dir, 'wbtv.db-wal')), false, 'no WAL orphaned under the old name');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM items').get().n, 1, 'and the library is intact');
  } finally {
    db.close();
  }
});
