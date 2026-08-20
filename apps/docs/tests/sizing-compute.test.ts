import { bloomSizing } from "distillate/bloom";
import { expect, test } from "vitest";

import { computeSizing } from "../src/components/sizing/compute.js";

test("classic bloom sizing matches bloomSizing for the documented 1e8 case", () => {
  const report = computeSizing(1e8, 0.01);

  expect(report.bloom).toEqual({
    ok: true,
    bitsPerKey: 9.58505838,
    totalBytes: 119813230,
  });
});

test.each([
  [1e8, 0.01],
  [1e6, 1e-6],
  [1000, 0.1],
])(
  "classic bloom sizing tracks the library helper at n=%d eps=%d",
  (n, eps) => {
    const { m } = bloomSizing(n, eps);
    const result = computeSizing(n, eps).bloom;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bitsPerKey).toBeCloseTo(m / n, 10);
    expect(result.totalBytes).toBe(Math.ceil(m / 8));
  },
);
