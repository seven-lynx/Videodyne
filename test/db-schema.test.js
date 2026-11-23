import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA } from '../src/db.js';

// `openDb()` runs `SCHEMA` and then `migrate()`, so every other database test sees the union of the
// two and cannot tell which one supplied a column. This one reads `SCHEMA` alone: a fresh install
// must be correct by construction, with `migrate()` left as the upgrade path for databases written
// before a column existed. Three columns used to live in `migrate()` alone, which is why `SCHEMA`
// stopped describing the database it builds.
//
// It is a file of its own rather than a case in `test/db.test.js` on purpose: that file does not
// exist upstream, so a patch that appends to it is not cherry-pickable, and L5 refuses a fix that
// only applies on top of fork commits.

/** Column names of a table; the pragma's argument is bound, not concatenated (SQLite >= 3.16). */
const columns = (db, table) => db.prepare('SELECT name FROM pragma_table_info(?)').all(table).map((c) => c.name);

test('SCHEMA builds the columns that used to live only in migrate()', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(SCHEMA);
    assert.ok(columns(db, 'libraries').includes('channel_group'));
    assert.ok(columns(db, 'libraries').includes('group_mode'));
    assert.ok(columns(db, 'channels').includes('grp'));
    // At the end of each block, so a fresh table's order is what migrate() leaves on an old one.
    assert.deepEqual(columns(db, 'libraries').slice(-2), ['channel_group', 'group_mode']);
    assert.deepEqual(columns(db, 'channels').slice(-1), ['grp']);
    db.prepare("INSERT INTO libraries(id,name,path,type) VALUES(1,'Films','/media/films','movies')").run();
    assert.equal(db.prepare('SELECT group_mode FROM libraries WHERE id=1').get().group_mode, 'inferred', 'the NOT NULL default is half the fix');
  } finally {
    db.close();
  }
});
