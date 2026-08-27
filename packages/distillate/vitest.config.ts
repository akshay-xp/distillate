import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Files run one at a time because the allocation probe cannot survive
    // workers competing for CPU. Contention does not add noise to the
    // measurement, it changes what is measured: under load V8 declines to
    // inline the hash path, and `add` then really does allocate one encodeInto
    // result object per key. Measured over 30 full-suite runs, the probe failed
    // 1 in 30 with files in parallel and 0 in 30 without. Costs about 3.7s.
    fileParallelism: false,
    // Accuracy tests build + query 1e6-key sets; v8 coverage instrumentation
    // pushes them past the 5s default on CI runners.
    testTimeout: 30_000,
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
  },
});
