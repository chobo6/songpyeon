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

  test("users get a banned_at column that defaults to NULL", () => {
    const db = createDb(":memory:");
    db.prepare(`INSERT INTO users (google_sub) VALUES (?)`).run("sub-ban");

    const row = db.prepare(`SELECT banned_at FROM users WHERE google_sub = ?`).get("sub-ban") as {
      banned_at: string | null;
    };
    expect(row.banned_at).toBeNull();
  });

  // 정리는 admin/eventLog.ts의 recordEvent()가 아니라 여기(DB 오픈 시점)에서 한다 — 매
  // 입장/퇴장마다 동기 디스크 쓰기를 하나 더 만들지 않기 위해 옮겨졌음(그 이유는
  // createDb()의 주석 참고). 그래서 "쌓인 뒤 다음 오픈에서 정리되는지"를 검증하려면
  // 실제 파일 DB를 두 번 열어야 한다 — 위 "UTC created_at이 KST로 옮겨지는지" 테스트와
  // 같은 패턴.
  test("prunes events older than the 90-day retention window when the DB is (re)opened", () => {
    const tmpPath = path.join(os.tmpdir(), `songpyeon-test-events-${Date.now()}-${Math.random()}.db`);
    try {
      const db = createDb(tmpPath);
      const ninetyOneDaysAgo = Date.now() - 91 * 24 * 60 * 60 * 1000;
      const insertEvent = db.prepare(
        `INSERT INTO events (type, timestamp, nickname, room_id, room_title, ip, session_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      insertEvent.run("join", ninetyOneDaysAgo, "old", "room1", "방", "127.0.0.1", "sess-old");
      insertEvent.run("join", Date.now(), "new", "room1", "방", "127.0.0.1", "sess-new");
      db.close();

      // Re-opening is what actually triggers the cleanup — the first
      // createDb() above ran against an empty events table, so it had
      // nothing to prune yet.
      const reopened = createDb(tmpPath);
      const rows = reopened.prepare(`SELECT session_id AS sessionId FROM events`).all() as { sessionId: string }[];
      expect(rows.map((r) => r.sessionId)).toEqual(["sess-new"]);
      reopened.close();
    } finally {
      for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(tmpPath + suffix, { force: true });
    }
  });
});
