import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "forks",
    setupFiles: ["./vitest.setup.ts"],
  },
});
