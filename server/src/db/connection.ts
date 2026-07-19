import Database from "better-sqlite3";

export function createDb(filename: string): Database.Database {
  const db = new Database(filename);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      google_sub TEXT UNIQUE NOT NULL,
      email TEXT,
      name TEXT,
      nickname TEXT,
      max_round INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  // SQLite's UNIQUE index treats each NULL as distinct from every other NULL,
  // so accounts that haven't set a nickname yet (nickname IS NULL) don't
  // collide with each other — only two non-null nicknames can't match.
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_nickname ON users(nickname)`);

  // CREATE TABLE IF NOT EXISTS only defines max_round for a brand-new
  // database — it does nothing to the production DB file, which already has
  // a users table from before this column existed. ALTER TABLE ADD COLUMN
  // is the migration for that case; guarded so re-running it on an
  // already-migrated DB (every subsequent server start) is a no-op instead
  // of an error.
  const hasMaxRound = (db.prepare(`PRAGMA table_info(users)`).all() as { name: string }[]).some(
    (col) => col.name === "max_round",
  );
  if (!hasMaxRound) {
    db.exec(`ALTER TABLE users ADD COLUMN max_round INTEGER NOT NULL DEFAULT 0`);
  }

  return db;
}

export const db = createDb(process.env.SQLITE_DB_PATH ?? "data/songpyeon.db");
