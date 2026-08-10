import { beforeEach, describe, expect, test } from "vitest";
import { db } from "../db/connection";
import {
  _resetForTest,
  listDuoListings,
  removeDuoListing,
  sanitizeDuoDescription,
  sanitizeDuoPosition,
  sanitizeDuoTimeSlot,
  upsertDuoListing,
} from "./duoListings";

function insertUser(id: number, nickname: string, maxRound: number) {
  db.prepare(`INSERT INTO users (id, google_sub, nickname, max_round) VALUES (?, ?, ?, ?)`).run(
    id,
    `sub-${id}`,
    nickname,
    maxRound,
  );
}

describe("duoListings", () => {
  beforeEach(() => {
    _resetForTest();
    db.exec(`DELETE FROM users`);
    insertUser(1, "홍바들", 12);
    insertUser(2, "방랑", 7);
  });

  test("posting a listing shows up in listDuoListings, with the author's live max_round attached", () => {
    upsertDuoListing(1, "pig", "저녁 8시~11시", "손빠른분 구해요");

    const rows = listDuoListings();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: 1,
      nickname: "홍바들",
      maxRound: 12,
      position: "pig",
      timeSlot: "저녁 8시~11시",
      description: "손빠른분 구해요",
    });
  });

  test("maxRound reflects the user's current max_round, not a snapshot at posting time", () => {
    upsertDuoListing(1, "pig", "아무때나", "구합니다");
    db.prepare(`UPDATE users SET max_round = 20 WHERE id = 1`).run();

    expect(listDuoListings()[0].maxRound).toBe(20);
  });

  test("posting again from the same user overwrites the previous listing instead of adding a second one", () => {
    upsertDuoListing(1, "pig", "아침", "첫 글");
    upsertDuoListing(1, "rabbit", "밤", "수정된 글");

    const rows = listDuoListings();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ position: "rabbit", timeSlot: "밤", description: "수정된 글" });
  });

  test("removeDuoListing deletes only that user's listing", () => {
    upsertDuoListing(1, "pig", "아침", "글1");
    upsertDuoListing(2, "rabbit", "밤", "글2");

    removeDuoListing(1);

    const rows = listDuoListings();
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(2);
  });

  test("listDuoListings returns newest first", () => {
    upsertDuoListing(1, "pig", "아침", "먼저");
    db.prepare(`UPDATE duo_listings SET created_at = '2026-08-01 00:00:00' WHERE user_id = 1`).run();
    upsertDuoListing(2, "rabbit", "밤", "나중");
    db.prepare(`UPDATE duo_listings SET created_at = '2026-08-05 00:00:00' WHERE user_id = 2`).run();

    const rows = listDuoListings();
    expect(rows.map((r) => r.userId)).toEqual([2, 1]);
  });
});

describe("sanitizeDuoPosition", () => {
  test("accepts pig/rabbit/any", () => {
    expect(sanitizeDuoPosition("pig")).toBe("pig");
    expect(sanitizeDuoPosition("rabbit")).toBe("rabbit");
    expect(sanitizeDuoPosition("any")).toBe("any");
  });

  test("rejects anything else", () => {
    expect(sanitizeDuoPosition("dog")).toBe("");
    expect(sanitizeDuoPosition(undefined)).toBe("");
    expect(sanitizeDuoPosition(123)).toBe("");
  });
});

describe("sanitizeDuoTimeSlot / sanitizeDuoDescription", () => {
  test("trim whitespace", () => {
    expect(sanitizeDuoTimeSlot("  저녁  ")).toBe("저녁");
    expect(sanitizeDuoDescription("  hi  ")).toBe("hi");
  });

  test("truncate to their max lengths", () => {
    expect(sanitizeDuoTimeSlot("a".repeat(100))).toHaveLength(12);
    expect(sanitizeDuoDescription("a".repeat(100))).toHaveLength(30);
  });

  test("non-string input becomes empty string", () => {
    expect(sanitizeDuoTimeSlot(undefined)).toBe("");
    expect(sanitizeDuoDescription(undefined)).toBe("");
  });
});
