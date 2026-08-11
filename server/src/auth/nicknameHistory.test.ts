import { beforeEach, describe, expect, test } from "vitest";
import { _resetForTest, getNicknameHistory, recordNicknameChange, searchNicknameHistory } from "./nicknameHistory";

describe("nicknameHistory", () => {
  beforeEach(() => {
    _resetForTest();
  });

  test("records a change with old and new nickname", () => {
    recordNicknameChange(1, "옛날닉", "새닉", "ticket");

    const rows = getNicknameHistory(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ oldNickname: "옛날닉", newNickname: "새닉", source: "ticket" });
    expect(rows[0].changedAt).toBeTruthy();
  });

  test("initial set has null oldNickname", () => {
    recordNicknameChange(1, null, "첫닉네임", "initial");

    expect(getNicknameHistory(1)[0].oldNickname).toBeNull();
  });

  test("returns newest first", () => {
    recordNicknameChange(1, null, "A", "initial");
    recordNicknameChange(1, "A", "B", "ticket");
    recordNicknameChange(1, "B", "C", "admin");

    expect(getNicknameHistory(1).map((r) => r.newNickname)).toEqual(["C", "B", "A"]);
  });

  test("different users are tracked independently", () => {
    recordNicknameChange(1, null, "유저1", "initial");
    recordNicknameChange(2, null, "유저2", "initial");

    expect(getNicknameHistory(1)).toHaveLength(1);
    expect(getNicknameHistory(2)).toHaveLength(1);
  });

  test("searchNicknameHistory finds by old or new nickname", () => {
    recordNicknameChange(1, "옛날닉", "새닉", "ticket");

    expect(searchNicknameHistory("옛날닉")).toHaveLength(1);
    expect(searchNicknameHistory("새닉")).toHaveLength(1);
    expect(searchNicknameHistory("전혀다른닉")).toHaveLength(0);
  });
});
