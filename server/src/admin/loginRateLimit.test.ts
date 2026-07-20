import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { _resetForTest, isRateLimited, recordFailedAttempt, recordSuccessfulLogin } from "./loginRateLimit";

describe("loginRateLimit", () => {
  beforeEach(() => {
    _resetForTest();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("an IP with no attempts is not rate limited", () => {
    expect(isRateLimited("1.2.3.4")).toBe(false);
  });

  test("stays unlimited under the max attempt count", () => {
    for (let i = 0; i < 4; i++) recordFailedAttempt("1.2.3.4");
    expect(isRateLimited("1.2.3.4")).toBe(false);
  });

  test("becomes rate limited once the max attempt count is reached", () => {
    for (let i = 0; i < 5; i++) recordFailedAttempt("1.2.3.4");
    expect(isRateLimited("1.2.3.4")).toBe(true);
  });

  test("tracks each IP independently", () => {
    for (let i = 0; i < 5; i++) recordFailedAttempt("1.2.3.4");
    expect(isRateLimited("1.2.3.4")).toBe(true);
    expect(isRateLimited("5.6.7.8")).toBe(false);
  });

  test("a successful login clears that IP's failed-attempt count", () => {
    for (let i = 0; i < 5; i++) recordFailedAttempt("1.2.3.4");
    recordSuccessfulLogin("1.2.3.4");
    expect(isRateLimited("1.2.3.4")).toBe(false);
  });

  test("the lockout expires once the window has elapsed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    for (let i = 0; i < 5; i++) recordFailedAttempt("1.2.3.4");
    expect(isRateLimited("1.2.3.4")).toBe(true);

    vi.setSystemTime(15 * 60 * 1000);
    expect(isRateLimited("1.2.3.4")).toBe(false);
  });
});
