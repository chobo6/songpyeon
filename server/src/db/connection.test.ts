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
});
