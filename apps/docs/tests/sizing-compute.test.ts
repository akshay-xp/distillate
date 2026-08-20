import { blockedBitsPerKey } from "distillate/blocked";
import { bloomSizing } from "distillate/bloom";
import { fuseBitsPerKey } from "distillate/fuse";
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

test("fuse sizing matches fuseBitsPerKey for both widths", () => {
  const report = computeSizing(1e8, 0.01);

  expect(report.fuse8).toMatchObject({ ok: true, bitsPerKey: 9.00726784 });
  expect(report.fuse16).toMatchObject({ ok: true, bitsPerKey: 18.01453568 });
});

test.each([
  [1e8, 8],
  [1e6, 8],
  [1e6, 16],
] as const)(
  "fuse sizing tracks the library helper at n=%d width=%d",
  (n, width) => {
    const result =
      width === 8
        ? computeSizing(n, 0.01).fuse8
        : computeSizing(n, 0.01).fuse16;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bitsPerKey).toBe(fuseBitsPerKey(n, width));
    expect(result.totalBytes).toBe(
      Math.ceil((fuseBitsPerKey(n, width) * n) / 8),
    );
  },
);

test("fuse output states it is static and takes no target rate", () => {
  const report = computeSizing(1e8, 0.01);

  for (const result of [report.fuse8, report.fuse16]) {
    expect(result.ok).toBe(true);
    if (!result.ok) continue;
    expect(result.note).toMatch(/static/i);
    expect(result.note).toMatch(/insert/i);
    expect(result.note).toMatch(/epsilon|target/i);
  }
});

test("fuse ignores the epsilon input entirely", () => {
  const loose = computeSizing(1e8, 0.01);
  const tight = computeSizing(1e8, 1e-6);

  expect(loose.fuse8).toEqual(tight.fuse8);
  expect(loose.fuse16).toEqual(tight.fuse16);
});

const ALL = ["bloom", "blocked", "fuse8", "fuse16"] as const;

test.each(["", "abc", 0, -1, 1e15, NaN, Infinity])(
  "capacity %s is rejected with a message naming capacity",
  (capacity) => {
    const report = computeSizing(capacity, 0.01);

    for (const key of ALL) {
      const result = report[key];
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.message).toMatch(/capacity/i);
    }
  },
);

test.each([0, 1, -0.5, "x", NaN])(
  "target rate %s is rejected with a message naming the rate",
  (epsilon) => {
    const report = computeSizing(1e6, epsilon);

    for (const key of ALL) {
      const result = report[key];
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.message).toMatch(/rate|epsilon/i);
    }
  },
);

test("no bad input ever produces NaN or throws", () => {
  const bad: unknown[] = [
    "",
    "abc",
    0,
    -1,
    1e15,
    NaN,
    Infinity,
    null,
    undefined,
    {},
  ];

  for (const capacity of bad) {
    for (const epsilon of bad) {
      expect(() => computeSizing(capacity, epsilon)).not.toThrow();
      const report = computeSizing(capacity, epsilon);
      for (const key of ALL) {
        const result = report[key];
        if (result.ok) {
          expect(Number.isNaN(result.bitsPerKey)).toBe(false);
          expect(Number.isNaN(result.totalBytes)).toBe(false);
        }
      }
    }
  }
});
