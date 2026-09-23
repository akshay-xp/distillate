import { BlockedBloomFilter } from "distillate/blocked";
import { bloomSizing } from "distillate/bloom";
import { BinaryFuse8, BinaryFuseBuildError } from "distillate/fuse";
import { CuckooFilter } from "distillate/cuckoo";
import { ScalableBloomFilter } from "distillate/scalable";
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

test("all five structures are built from the same key set", () => {
  const report = built().report();

  expect(report.keyCount).toBe(KEYS);
  for (const key of [
    "bloom",
    "blocked",
    "fuse8",
    "scalable",
    "cuckoo",
  ] as const) {
    expect(report.structures[key].heldKeys).toBe(KEYS);
  }
});

test("every inserted key is found, in every structure", () => {
  const report = built().report();

  for (const key of [
    "bloom",
    "blocked",
    "fuse8",
    "scalable",
    "cuckoo",
  ] as const) {
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
  // It is the one structure that allocates on add, so its size is read from
  // the bits it holds rather than priced from the build.
  const scalable = ScalableBloomFilter.from(SAME_KEYS, TARGET);
  expect(structures.scalable.bitsPerKey).toBe(scalable.bitsPerKey);
  expect(structures.scalable.totalBytes).toBe(Math.ceil(scalable.m / 8));
  const cuckoo = CuckooFilter.from(SAME_KEYS, TARGET);
  expect(structures.cuckoo.bitsPerKey).toBe(cuckoo.bitsPerKey);
  expect(structures.cuckoo.totalBytes).toBe(Math.ceil(cuckoo.m / 8));

  // Cuckoo is checked against its own m above: bitsPerKey is m / n, and
  // multiplying back lands a hair past m in floating point.
  for (const key of ["bloom", "blocked", "fuse8", "scalable"] as const) {
    const { bitsPerKey, totalBytes } = structures[key];
    expect(totalBytes).toBe(Math.ceil((bitsPerKey * KEYS) / 8));
  }
});

test("every structure starts as a single table", () => {
  const { structures } = built().report();

  for (const key of [
    "bloom",
    "blocked",
    "fuse8",
    "scalable",
    "cuckoo",
  ] as const) {
    expect(structures[key].stages).toBe(1);
  }
});

test("the miss set is 20,000 keys and the rate is measured against it", () => {
  const { probeCount, structures } = built().report();

  expect(probeCount).toBe(20_000);
  for (const key of [
    "bloom",
    "blocked",
    "fuse8",
    "scalable",
    "cuckoo",
  ] as const) {
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
    verdicts: {
      bloom: "member",
      blocked: "member",
      fuse8: "member",
      scalable: "member",
      cuckoo: "member",
    },
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
    verdicts: {
      bloom: "absent",
      blocked: "absent",
      fuse8: "absent",
      scalable: "absent",
      cuckoo: "absent",
    },
  });
});

test("a late key is taken by every bloom filter and refused by fuse", () => {
  const playground = built();

  const insert = playground.insert("late-key");

  expect(insert.key).toBe("late-key");
  expect(insert.keyCount).toBe(KEYS + 1);
  expect(insert.fuseRefusal).toContain("Binary Fuse");
  expect(insert.fuseRefusal).toContain("static");
  expect(insert.fuseRefusal).toContain("Scalable Bloom");
  expect(insert.fuseRefusal).toContain("Cuckoo");
});

test("a late key leaves neither structure with a false negative", () => {
  const playground = built();
  playground.insert("late-key");

  const { structures } = playground.report();

  expect(structures.bloom.heldKeys).toBe(KEYS + 1);
  expect(structures.blocked.heldKeys).toBe(KEYS + 1);
  expect(structures.scalable.heldKeys).toBe(KEYS + 1);
  expect(structures.cuckoo.heldKeys).toBe(KEYS + 1);
  expect(structures.fuse8.heldKeys).toBe(KEYS);
  for (const key of [
    "bloom",
    "blocked",
    "fuse8",
    "scalable",
    "cuckoo",
  ] as const) {
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
      scalable: "member",
      cuckoo: "member",
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

// The contrast the playground exists to show: past its build the fixed-size
// filter drifts over target while the scalable one opens stages to stay under.
test("growing past the build opens stages and holds the target", () => {
  const playground = built();

  const result = playground.grow(30_000);
  const { structures } = playground.report();

  expect(result).toMatchObject({ ok: true, keyCount: 40_000 });
  expect(structures.scalable.stages).toBeGreaterThanOrEqual(3);
  expect(structures.scalable.measuredFpr).toBeLessThanOrEqual(TARGET);
  expect(structures.bloom.measuredFpr).toBeGreaterThan(TARGET);
  expect(structures.fuse8.heldKeys).toBe(KEYS);
  for (const key of ["bloom", "blocked", "fuse8", "scalable"] as const) {
    expect(structures[key].missing).toBe(0);
  }
});

test.each([0, -1, 1.5, "abc", "", null, 90_001])(
  "growing by %o is refused, naming the bound, and changes nothing",
  (count) => {
    const playground = built();

    const result = playground.grow(count);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("100,000");
    expect(playground.report().keyCount).toBe(KEYS);
  },
);

test("growing to the bound itself is allowed", () => {
  expect(built().grow(MAX_KEYS - KEYS)).toMatchObject({
    ok: true,
    keyCount: MAX_KEYS,
  });
});

// Cuckoo is sized for the build and cannot grow, so past it the keys it has
// no room for are refused, and every key it did take is still found.
test("a full Cuckoo refuses keys without losing any it held", () => {
  const playground = built();

  const result = playground.grow(30_000);
  const { structures } = playground.report();

  if (!result.ok) throw new Error(result.message);
  expect(result.cuckooRefused).toBeGreaterThan(0);
  expect(structures.cuckoo.heldKeys).toBe(40_000 - result.cuckooRefused);
  expect(structures.cuckoo.missing).toBe(0);
  expect(structures.bloom.heldKeys).toBe(40_000);
});

// A wedge guard like the build's. Each refused add costs 500 kicks and an
// undo, so offering every key to a full Cuckoo took 3 s at the bound; the
// playground stops offering keys once one is refused.
test("growing to the bound stays far inside a responsive budget", () => {
  const playground = built();
  const started = performance.now();
  playground.grow(MAX_KEYS - KEYS);

  expect(performance.now() - started).toBeLessThan(1500);
});

// 10,000 keys get 2,732 buckets, 10,928 slots, so 100 more still fit.
test("growing inside Cuckoo's room refuses nothing", () => {
  expect(built().grow(100)).toEqual({
    ok: true,
    keyCount: KEYS + 100,
    cuckooRefused: 0,
  });
});

test("delete takes a key out of Cuckoo and says why the others keep it", () => {
  const playground = built();

  const result = playground.remove("key-5");

  if (!result.ok) throw new Error(result.message);
  expect(result.key).toBe("key-5");
  for (const phrase of ["Classic", "Binary Fuse", "shared"]) {
    expect(result.refusal, phrase).toContain(phrase);
  }
  const { verdicts } = playground.lookup("key-5");
  expect(verdicts.cuckoo).not.toBe("member");
  expect(verdicts.bloom).toBe("member");
});

// The guarantee delete must keep: the one key goes, every other stays found.
test("a delete leaves no other held key missing from Cuckoo", () => {
  const playground = built();
  playground.remove("key-5");

  const { structures } = playground.report();

  expect(structures.cuckoo.heldKeys).toBe(KEYS - 1);
  expect(structures.cuckoo.missing).toBe(0);
  expect(structures.bloom.heldKeys).toBe(KEYS);
});

// Deleting a key never added can remove another key's fingerprint, so the
// playground refuses rather than demonstrate the one misuse the guide warns of.
test("delete refuses a key that was never added, or is already gone", () => {
  const playground = built();
  const before = playground.report();

  const never = playground.remove("never-added");
  expect(never.ok).toBe(false);
  if (!never.ok) expect(never.message).toContain("only delete keys");
  expect(playground.report()).toEqual(before);

  playground.remove("key-5");
  const again = playground.remove("key-5");
  expect(again.ok).toBe(false);
  if (!again.ok) expect(again.message).toContain("only delete keys");
});

test("adding a deleted key back puts it back in Cuckoo", () => {
  const playground = built();
  playground.remove("key-5");

  playground.insert("key-5");

  expect(playground.lookup("key-5").verdicts.cuckoo).toBe("member");
  expect(playground.report().structures.cuckoo.heldKeys).toBe(KEYS);
});

test("the sketch counts the build set and never reads below the truth", () => {
  const pg = built(1000);
  const report = pg.estimate("key-5");

  expect(report.key).toBe("key-5");
  expect(report.trueCount).toBe(1);
  expect(report.estimate).toBeGreaterThanOrEqual(1);
  expect(report.overestimate).toBe(report.estimate - report.trueCount);
  expect(report.total).toBe(1000);

  expect(pg.estimate("never-seen").trueCount).toBe(0);

  // The sketch's one hard guarantee, checked over every key it was built from
  // rather than the one the panel happens to show.
  for (let i = 0; i < 1000; i += 1) {
    const r = pg.estimate(`key-${String(i)}`);
    expect(r.estimate, `key-${String(i)}`).toBeGreaterThanOrEqual(r.trueCount);
  }
});
