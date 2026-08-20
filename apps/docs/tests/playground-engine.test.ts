import { BlockedBloomFilter } from "distillate/blocked";
import { bloomSizing } from "distillate/bloom";
import { BinaryFuse8, BinaryFuseBuildError } from "distillate/fuse";
import { expect, test } from "vitest";

import {
  MAX_KEYS,
  Playground,
  toMessage,
} from "../src/components/playground/engine.js";

const KEYS = 10_000;
const TARGET = 0.01;

/** The same keys the engine generates, so a filter built here is comparable. */
const SAME_KEYS = Array.from({ length: KEYS }, (_, i) => `key-${String(i)}`);

function built(keyCount: number = KEYS, target: number = TARGET) {
  const result = Playground.build(keyCount, target);
  if (!result.ok) throw new Error(`build refused: ${result.message}`);
  return result.playground;
}

test("all three structures are built from the same key set", () => {
  const report = built().report();

  expect(report.keyCount).toBe(KEYS);
  for (const key of ["bloom", "blocked", "fuse8"] as const) {
    expect(report.structures[key].heldKeys).toBe(KEYS);
  }
});

test("every inserted key is found, in every structure", () => {
  const report = built().report();

  for (const key of ["bloom", "blocked", "fuse8"] as const) {
    expect(report.structures[key].missing).toBe(0);
  }
});

test("reported space matches what the library allocated", () => {
  const { structures } = built().report();

  expect(structures.bloom.bitsPerKey).toBeCloseTo(
    bloomSizing(KEYS, TARGET).m / KEYS,
    10,
  );
  // Blocked and fuse round their allocation up in structure-specific ways, so
  // the honest reference is a filter built over the same keys, not a formula.
  expect(structures.blocked.bitsPerKey).toBe(
    BlockedBloomFilter.from(SAME_KEYS, TARGET).bitsPerKey,
  );
  expect(structures.fuse8.bitsPerKey).toBe(
    BinaryFuse8.from(SAME_KEYS).bitsPerKey,
  );

  for (const key of ["bloom", "blocked", "fuse8"] as const) {
    const { bitsPerKey, totalBytes } = structures[key];
    expect(totalBytes).toBe(Math.ceil((bitsPerKey * KEYS) / 8));
  }
});

test("the miss set is 20,000 keys and the rate is measured against it", () => {
  const { probeCount, structures } = built().report();

  expect(probeCount).toBe(20_000);
  for (const key of ["bloom", "blocked", "fuse8"] as const) {
    const { falsePositives, measuredFpr } = structures[key];
    expect(measuredFpr).toBe(falsePositives / probeCount);
  }
});

test("both bloom variants land within a factor of two of the target", () => {
  const { structures } = built().report();

  for (const key of ["bloom", "blocked"] as const) {
    expect(structures[key].measuredFpr).toBeGreaterThanOrEqual(TARGET / 2);
    expect(structures[key].measuredFpr).toBeLessThanOrEqual(TARGET * 2);
  }
});

test("fuse holds its fingerprint-fixed rate whatever the target is", () => {
  for (const target of [TARGET, 0.2, 1e-4]) {
    const { measuredFpr } = built(KEYS, target).report().structures.fuse8;

    expect(measuredFpr).toBeGreaterThanOrEqual(0.002);
    expect(measuredFpr).toBeLessThanOrEqual(0.006);
  }
});

// 1e9 is here to prove the refusal happens before any allocation: attempting
// it would exhaust memory rather than return a message.
test.each([100_001, 1e9, 0, -1, 1.5, "abc", "", null, undefined])(
  "a key count of %o is refused, naming the bound",
  (keyCount) => {
    const result = Playground.build(keyCount, TARGET);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("100,000");
  },
);

test("the bound itself is buildable", () => {
  expect(Playground.build(MAX_KEYS, TARGET).ok).toBe(true);
});

// A wedge guard, not a benchmark. Building at the bound measured 61 ms here,
// so 3000 ms is roughly 50x headroom: it fires only if the bound grows to
// something that would freeze the tab, never on a slow machine.
test("building at the bound stays far inside a responsive budget", () => {
  const started = performance.now();
  const result = Playground.build(MAX_KEYS, TARGET);
  const elapsed = performance.now() - started;

  expect(result.ok).toBe(true);
  expect(elapsed).toBeLessThan(3000);
});

test("an out-of-range target rate is a message, not an exception", () => {
  const result = Playground.build(1000, 1.5);

  expect(result).toEqual({
    ok: false,
    message: "epsilon must be in the open interval (0, 1), got 1.5",
  });
});

test("a target under the blocked floor is a message, not an exception", () => {
  const result = Playground.build(1000, 1e-9);

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.message).toContain("below the blocked-filter floor");
});

test("anything that is not a ParamError still propagates", () => {
  const boom = new TypeError("not a param problem");

  expect(() => {
    toMessage(boom);
  }).toThrow(boom);
});

test("a target typed into the form arrives as a string and still builds", () => {
  expect(Playground.build(1000, "0.01").ok).toBe(true);
});

test.each(["", "abc", null, undefined])(
  "a target of %o is refused as a rate, not misreported as one",
  (target) => {
    const result = Playground.build(1000, target);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("greater than 0 and less than 1");
  },
);

// The peeling loop converges for every realistic key set, so there is no
// honest input that triggers this. Tested on the error itself instead.
test("a fuse build failure reads as an instruction, not as a status line", () => {
  const raw = "binary fuse construction failed";

  const message = toMessage(new BinaryFuseBuildError(raw));

  expect(message).not.toBe(raw);
  expect(message).toContain("Binary Fuse");
  expect(message).toContain("key count");
});

test("a key that was inserted reads as a member everywhere", () => {
  const result = built().lookup("key-5");

  expect(result).toEqual({
    key: "key-5",
    inserted: true,
    verdicts: { bloom: "member", blocked: "member", fuse8: "member" },
  });
});

test("a hit on a never-inserted key is a false positive, not a member", () => {
  const result = built().lookup("miss-22");

  expect(result.inserted).toBe(false);
  expect(result.verdicts.bloom).toBe("false positive");
});

test("a miss on a never-inserted key is simply absent", () => {
  const result = built().lookup("miss-0");

  expect(result).toEqual({
    key: "miss-0",
    inserted: false,
    verdicts: { bloom: "absent", blocked: "absent", fuse8: "absent" },
  });
});

test("a late key is taken by both bloom filters and refused by fuse", () => {
  const playground = built();

  const insert = playground.insert("late-key");

  expect(insert.key).toBe("late-key");
  expect(insert.keyCount).toBe(KEYS + 1);
  expect(insert.fuseRefusal).toContain("Binary Fuse");
  expect(insert.fuseRefusal).toContain("static");
});

test("a late key leaves neither structure with a false negative", () => {
  const playground = built();
  playground.insert("late-key");

  const { structures } = playground.report();

  expect(structures.bloom.heldKeys).toBe(KEYS + 1);
  expect(structures.blocked.heldKeys).toBe(KEYS + 1);
  expect(structures.fuse8.heldKeys).toBe(KEYS);
  for (const key of ["bloom", "blocked", "fuse8"] as const) {
    expect(structures[key].missing).toBe(0);
  }
});

test("a late key is outside the fuse build, not missing from it", () => {
  const playground = built();
  playground.insert("late-key");

  expect(playground.lookup("late-key")).toEqual({
    key: "late-key",
    inserted: true,
    verdicts: {
      bloom: "member",
      blocked: "member",
      fuse8: "added after build",
    },
  });
});

test("inserting a probe key drops it from the measurement", () => {
  const playground = built();
  const before = playground.report();

  playground.insert("miss-22");
  const after = playground.report();

  expect(before.structures.bloom.falsePositives).toBeGreaterThan(0);
  expect(after.probeCount).toBe(before.probeCount - 1);
  expect(after.structures.bloom.falsePositives).toBe(
    before.structures.bloom.falsePositives - 1,
  );
});
