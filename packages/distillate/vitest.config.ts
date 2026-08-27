import { defineConfig } from "vitest/config";

const PROBE = "tests/hll/allocation.test.ts";

const shared = {
  environment: "node" as const,
  // Accuracy tests build + query 1e6-key sets; v8 coverage instrumentation
  // pushes them past the 5s default on CI runners.
  testTimeout: 30_000,
};

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "lcov"],
      thresholds: {
        lines: 90,
        functions: 90,
        statements: 90,
        branches: 65,
      },
    },
    projects: [
      {
        test: {
          ...shared,
          name: "unit",
          include: ["tests/**/*.test.ts"],
          exclude: [PROBE],
        },
      },
      {
        // The allocation probe cannot share a machine with other test files.
        // Workers competing for CPU do not make it noisier, they change what it
        // measures: under load V8 declines to inline the hash path, and add()
        // then really does allocate one encodeInto result object per key.
        //
        // maxWorkers 1 puts this project in vitest's sequential group, which is
        // ordered after every other group, so it runs on its own at the end
        // while the rest of the suite still runs in parallel.
        test: {
          ...shared,
          name: "allocation",
          include: [PROBE],
          maxWorkers: 1,
        },
      },
    ],
  },
});
