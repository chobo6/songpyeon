import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { createDb } from "./connection";

describe("createDb", () => {
  test("creates a users table with the expected columns", () => {
    const db = createDb(":memory:");
    db.prepare(
      `INSERT INTO users (google_sub, email, name, nickname) VALUES (?, ?, ?, ?)`,
    ).run("sub-1", "a@example.com", "Alice", "닉네임1");

    const row = db.prepare(`SELECT * FROM users WHERE google_sub = ?`).get("sub-1") as {
      id: number;
      google_sub: string;
      email: string;
      name: string;
      nickname: string;
      created_at: string;
    };

    expect(row.google_sub).toBe("sub-1");
    expect(row.email).toBe("a@example.com");
    expect(row.nickname).toBe("닉네임1");
    expect(row.created_at).toBeTruthy();
  });

  test("google_sub is unique — a duplicate insert throws", () => {
    const db = createDb(":memory:");
    db.prepare(`INSERT INTO users (google_sub) VALUES (?)`).run("sub-dup");
    expect(() => db.prepare(`INSERT INTO users (google_sub) VALUES (?)`).run("sub-dup")).toThrow();
  });

  test("calling createDb twice with :memory: gives independent databases", () => {
    const dbA = createDb(":memory:");
    const dbB = createDb(":memory:");
    dbA.prepare(`INSERT INTO users (google_sub) VALUES (?)`).run("only-in-a");
    const rowInB = dbB.prepare(`SELECT * FROM users WHERE google_sub = ?`).get("only-in-a");
    expect(rowInB).toBeUndefined();
  });

  test("created_at defaults to KST (UTC+9), not UTC", () => {
    const db = createDb(":memory:");
    db.prepare(`INSERT INTO users (google_sub) VALUES (?)`).run("sub-kst");

    const row = db.prepare(`SELECT created_at FROM users WHERE google_sub = ?`).get("sub-kst") as {
      created_at: string;
    };
    const { utcNow } = db.prepare(`SELECT datetime('now') AS utcNow`).get() as { utcNow: string };

    const diffMs =
      new Date(`${row.created_at.replace(" ", "T")}Z`).getTime() -
      new Date(`${utcNow.replace(" ", "T")}Z`).getTime();
    expect(diffMs).toBeGreaterThan(8.9 * 60 * 60 * 1000);
    expect(diffMs).toBeLessThan(9.1 * 60 * 60 * 1000);
  });

  test("a pre-existing DB's UTC created_at values are shifted to KST exactly once", () => {
    const tmpPath = path.join(os.tmpdir(), `songpyeon-test-${Date.now()}-${Math.random()}.db`);
    try {
      // Simulate a DB file written before created_at switched to KST: old
      // schema (UTC default), no max_round column, user_version untouched.
      const legacyDb = new Database(tmpPath);
      legacyDb.exec(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          google_sub TEXT UNIQUE NOT NULL,
          email TEXT,
          name TEXT,
          nickname TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      legacyDb
        .prepare(`INSERT INTO users (google_sub, created_at) VALUES (?, ?)`)
        .run("legacy-sub", "2026-01-01 00:00:00");
      legacyDb.close();

      const migrated = createDb(tmpPath);
      const row = migrated.prepare(`SELECT created_at FROM users WHERE google_sub = ?`).get("legacy-sub") as {
        created_at: string;
      };
      expect(row.created_at).toBe("2026-01-01 09:00:00");
      migrated.close();

      // Re-opening must not shift an already-migrated row a second time.
      const reopened = createDb(tmpPath);
      const rowAgain = reopened.prepare(`SELECT created_at FROM users WHERE google_sub = ?`).get("legacy-sub") as {
        created_at: string;
      };
      expect(rowAgain.created_at).toBe("2026-01-01 09:00:00");
      reopened.close();
    } finally {
      for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(tmpPath + suffix, { force: true });
    }
  });
});
