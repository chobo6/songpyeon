import { describe, expect, test } from "vitest";
import { colorRole } from "./colors";

describe("colorRole", () => {
  test.each([
    ["red", "pig"],
    ["orange", "pig"],
    ["yellow", "pig"],
    ["purple", "pig"],
    ["mint", "rabbit"],
    ["green", "rabbit"],
    ["blue", "rabbit"],
    ["pink", "rabbit"],
  ] as const)("%s belongs to %s", (color, role) => {
    expect(colorRole(color)).toBe(role);
  });
});
