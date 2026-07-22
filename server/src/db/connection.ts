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
      banned_at TEXT,
      nickname_color TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
    )
  `);
  // SQLite's UNIQUE index treats each NULL as distinct from every other NULL,
  // so accounts that haven't set a nickname yet (nickname IS NULL) don't
  // collide with each other — only two non-null nicknames can't match.
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_nickname ON users(nickname)`);

  // 입장/퇴장 로그(IP 포함) — 예전엔 서버 메모리에만 있어서 재배포/재시작마다
  // 사라졌음(admin/eventLog.ts 참고). DB로 옮겨 재시작을 견디게 함.
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      nickname TEXT NOT NULL,
      room_id TEXT NOT NULL,
      room_title TEXT NOT NULL,
      ip TEXT NOT NULL,
      session_id TEXT NOT NULL
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp)`);

  // CREATE TABLE IF NOT EXISTS only defines max_round/banned_at for a
  // brand-new database — it does nothing to the production DB file, which
  // already has a users table from before these columns existed. ALTER
  // TABLE ADD COLUMN is the migration for that case; guarded so re-running
  // it on an already-migrated DB (every subsequent server start) is a no-op
  // instead of an error.
  const columns = (db.prepare(`PRAGMA table_info(users)`).all() as { name: string }[]).map((col) => col.name);
  if (!columns.includes("max_round")) {
    db.exec(`ALTER TABLE users ADD COLUMN max_round INTEGER NOT NULL DEFAULT 0`);
  }
  if (!columns.includes("banned_at")) {
    db.exec(`ALTER TABLE users ADD COLUMN banned_at TEXT`);
  }
  if (!columns.includes("nickname_color")) {
    db.exec(`ALTER TABLE users ADD COLUMN nickname_color TEXT`);
  }

  // created_at used to default to UTC (datetime('now')); rows written before
  // this changed to KST (+9 hours, above and in getOrCreateUser's INSERT)
  // still hold UTC values. user_version gates the one-time shift so it never
  // re-runs on a later startup and drifts already-corrected rows forward
  // again — SQLite databases default to user_version 0 and nothing else in
  // this app touches that pragma.
  const schemaVersion = db.pragma("user_version", { simple: true }) as number;
  if (schemaVersion < 1) {
    db.exec(`UPDATE users SET created_at = datetime(created_at, '+9 hours')`);
    db.pragma("user_version = 1");
  }

  return db;
}

export const db = createDb(process.env.SQLITE_DB_PATH ?? "data/songpyeon.db");
