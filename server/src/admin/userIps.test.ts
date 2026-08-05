import { beforeEach, describe, expect, test } from "vitest";
import { db } from "../db/connection";
import { _resetForTest, getIpsForUser, recordUserIp } from "./userIps";

describe("userIps", () => {
  beforeEach(() => {
    _resetForTest();
  });

  test("recording the same user+IP multiple times keeps only one row", () => {
    recordUserIp(1, "1.2.3.4");
    recordUserIp(1, "1.2.3.4");

    const rows = getIpsForUser(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].ip).toBe("1.2.3.4");
  });

  test("recording a different IP for the same user adds a new row without touching the old one", () => {
    recordUserIp(1, "1.1.1.1");
    const firstSeenBefore = getIpsForUser(1)[0].firstSeen;

    recordUserIp(1, "2.2.2.2");

    const rows = getIpsForUser(1);
    expect(rows).toHaveLength(2);
    const old = rows.find((r) => r.ip === "1.1.1.1");
    expect(old?.firstSeen).toBe(firstSeenBefore);
  });

  test("different users recording the same IP are tracked independently", () => {
    recordUserIp(1, "9.9.9.9");
    recordUserIp(2, "9.9.9.9");

    expect(getIpsForUser(1)).toHaveLength(1);
    expect(getIpsForUser(2)).toHaveLength(1);
  });

  test("ip === 'unknown' is not recorded", () => {
    recordUserIp(1, "unknown");

    expect(getIpsForUser(1)).toHaveLength(0);
  });

  test("getIpsForUser returns rows sorted by last_seen descending", () => {
    db.prepare(`INSERT INTO user_ips (user_id, ip, first_seen, last_seen) VALUES (?, ?, ?, ?)`).run(
      1,
      "1.1.1.1",
      "2026-08-01 00:00:00",
      "2026-08-01 00:00:00",
    );
    db.prepare(`INSERT INTO user_ips (user_id, ip, first_seen, last_seen) VALUES (?, ?, ?, ?)`).run(
      1,
      "2.2.2.2",
      "2026-08-03 00:00:00",
      "2026-08-03 00:00:00",
    );

    const rows = getIpsForUser(1);
    expect(rows.map((r) => r.ip)).toEqual(["2.2.2.2", "1.1.1.1"]);
  });
});
