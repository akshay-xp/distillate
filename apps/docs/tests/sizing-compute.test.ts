import { blockedBitsPerKey } from "distillate/blocked";
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

test("blocked bloom sizing matches blockedBitsPerKey", () => {
  const result = computeSizing(1e8, 0.01).blocked;

  expect(result).toEqual({
    ok: true,
    bitsPerKey: 11,
    totalBytes: Math.ceil((11 * 1e8) / 8),
  });
});

test.each([
  [1e8, 0.01],
  [1e6, 1e-4],
  [1000, 0.1],
])("blocked sizing tracks the library helper at n=%d eps=%d", (n, eps) => {
  const result = computeSizing(n, eps).blocked;

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.bitsPerKey).toBe(blockedBitsPerKey(eps));
});

test("a target below the blocked floor becomes a message, not an exception", () => {
  expect(() => computeSizing(1e8, 1e-9)).not.toThrow();

  const result = computeSizing(1e8, 1e-9).blocked;

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.message).toMatch(/floor/i);
});
