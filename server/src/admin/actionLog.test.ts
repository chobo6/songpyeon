import { beforeEach, describe, expect, test } from "vitest";
import { _resetForTest, getActionLog, isTrackedNickname, recordAction, type AdminAction } from "./actionLog";

function makeAction(overrides: Partial<AdminAction> = {}): AdminAction {
  return {
    timestamp: Date.now(),
    nickname: "렌아",
    action: "pressButton",
    detail: "red",
    ip: "127.0.0.1",
    ...overrides,
  };
}

describe("isTrackedNickname", () => {
  test("is true only for the tracked nickname", () => {
    expect(isTrackedNickname("렌아")).toBe(true);
    expect(isTrackedNickname("다른유저")).toBe(false);
  });
});

describe("recordAction / getActionLog", () => {
  beforeEach(() => {
    _resetForTest();
  });

  test("records an action for the tracked nickname", () => {
    const action = makeAction();
    recordAction(action);

    expect(getActionLog()).toEqual([action]);
  });

  test("does not record actions for other nicknames", () => {
    recordAction(makeAction({ nickname: "다른유저" }));

    expect(getActionLog()).toEqual([]);
  });

  test("returns actions in insertion order", () => {
    recordAction(makeAction({ action: "chooseRole", detail: "pig" }));
    recordAction(makeAction({ action: "pressButton", detail: "blue" }));

    expect(getActionLog().map((a) => a.action)).toEqual(["chooseRole", "pressButton"]);
  });
});
