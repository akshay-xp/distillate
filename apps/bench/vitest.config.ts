import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Rows are built + measured over a 1e6 miss set; real work, not a hang.
    testTimeout: 60_000,
  },
});
