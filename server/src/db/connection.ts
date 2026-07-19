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
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  return db;
}

export const db = createDb(process.env.SQLITE_DB_PATH ?? "data/songpyeon.db");
