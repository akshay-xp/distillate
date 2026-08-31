import fc from "fast-check";
import { expect, test } from "vitest";

import { BloomFilter } from "../../src/bloom/bloom.js";
import { crc32 } from "../../src/core/crc32.js";
import {
  BadMagicError,
  ChecksumError,
  FORMAT_VERSION,
  SerializationError,
  TruncatedError,
  UnknownHashVariantError,
  UnknownVersionError,
  writeHeader,
} from "../../src/core/serialize.js";
import { HyperLogLog } from "../../src/hll/hll.js";
import { Registers } from "../../src/hll/registers.js";

const sketchOf = (n: number, p = 14, tag = "ser"): HyperLogLog => {
  const sketch = new HyperLogLog({ p });
  for (let i = 0; i < n; i++) sketch.add(`${tag}:${String(i)}`);
  return sketch;
};

test("a frame declares itself a version 4 DSTL sketch", () => {
  const frame = sketchOf(5000).toBytes();
  expect([...frame.subarray(0, 4)]).toEqual([0x44, 0x53, 0x54, 0x4c]);
  expect(frame[4]).toBe(FORMAT_VERSION);
  expect(frame[5]).toBe(5);
});

test("a dense sketch round-trips to an identical sketch", () => {
  // 5000 keys at p=14 and 10 at p=4 are both well past their buffers.
  for (const [n, p] of [
    [5000, 14],
    [10, 4],
  ] as const) {
    const sketch = sketchOf(n, p);
    const restored = HyperLogLog.fromBytes(sketch.toBytes());
    expect(restored.equals(sketch)).toBe(true);
    expect(restored.count()).toBe(sketch.count());
    expect(restored.p).toBe(p);
    expect(restored.seed).toBe(sketch.seed);
  }
});

test("a seed survives serialization", () => {
  const sketch = new HyperLogLog({ p: 14, seed: 0xdeadbeef });
  for (let i = 0; i < 5000; i++) sketch.add(`seeded:${String(i)}`);
  const restored = HyperLogLog.fromBytes(sketch.toBytes());
  expect(restored.seed).toBe(0xdeadbeef);
  expect(restored.equals(sketch)).toBe(true);
});

// A sparse sketch counts exactly where a dense one estimates, so writing it out
// as registers would lose the property even where the registers still matched.
test("a sparse sketch is written as entries, not as registers", () => {
  const sparse = sketchOf(100).toBytes();
  const dense = sketchOf(5000).toBytes();

  // 16 header + 6 params + 12288 registers + 4 CRC.
  expect(dense.length).toBe(12_314);
  expect(sparse.length).toBeLessThan(1000);
  // The body opens after the 16-byte header: p, then the encoding byte.
  expect(sparse[17]).toBe(1);
  expect(dense[17]).toBe(0);
});

test("a sparse sketch round-trips and still counts exactly", () => {
  const sketch = sketchOf(100);
  expect(sketch.count()).toBe(100);

  const restored = HyperLogLog.fromBytes(sketch.toBytes());
  expect(restored.equals(sketch)).toBe(true);
  expect(restored.count()).toBe(100);
});

test("an empty sketch round-trips", () => {
  const sketch = new HyperLogLog({ p: 14 });
  const restored = HyperLogLog.fromBytes(sketch.toBytes());
  expect(restored.equals(sketch)).toBe(true);
  expect(restored.count()).toBe(0);
});

test("a restored sparse sketch keeps taking keys", () => {
  const sketch = sketchOf(100);
  const restored = HyperLogLog.fromBytes(sketch.toBytes());
  for (let i = 100; i < 200; i++) restored.add(`ser:${String(i)}`);
  expect(restored.count()).toBe(200);
});

test("a sparse payload that is not whole entries is rejected", () => {
  const frame = sketchOf(100).toBytes();
  // Drop one byte from the body and restate the declared length, so the frame
  // is well-formed right up to the entry arithmetic.
  const cut = new Uint8Array(frame.length - 1);
  cut.set(frame.subarray(0, frame.length - 5));
  const view = new DataView(cut.buffer);
  view.setUint32(8, cut.length - 20, true);
  view.setUint32(cut.length - 4, crc32(cut.subarray(0, cut.length - 4)), true);

  expect(() => HyperLogLog.fromBytes(cut)).toThrow(TruncatedError);
});

test("a sparse payload larger than the buffer at that precision is rejected", () => {
  // p=4 holds three entries; hand it four.
  const body = new Uint8Array(6 + 4 * 4);
  body[0] = 4;
  body[1] = 1;
  const frame = writeHeader(
    { version: FORMAT_VERSION, type: 5, flags: 0 },
    body,
  );
  expect(() => HyperLogLog.fromBytes(frame)).toThrow(TruncatedError);
});

// Exhaustive rather than sampled: the claim is that *no* single-byte change
// gets through, and the frame has regions (magic, version, declared length,
// params, payload, CRC) that fail for quite different reasons.
test("no single corrupted byte survives decoding", () => {
  for (const frame of [sketchOf(100).toBytes(), sketchOf(10, 4).toBytes()]) {
    for (let i = 0; i < frame.length; i++) {
      const corrupt = frame.slice();
      corrupt[i] ^= 0xff;
      expect(() => HyperLogLog.fromBytes(corrupt)).toThrow(SerializationError);
    }
  }
});

// Guards the sweep above against passing for one uniform reason: each region
// has to be reached and rejected on its own terms.
test("each region of a frame is checked on its own terms", () => {
  const flip = (at: number): Uint8Array => {
    const corrupt = sketchOf(100).toBytes().slice();
    corrupt[at] ^= 0xff;
    return corrupt;
  };

  expect(() => HyperLogLog.fromBytes(flip(0))).toThrow(BadMagicError);
  expect(() => HyperLogLog.fromBytes(flip(4))).toThrow(UnknownVersionError);
  expect(() => HyperLogLog.fromBytes(flip(8))).toThrow(TruncatedError);
  expect(() => HyperLogLog.fromBytes(flip(20))).toThrow(ChecksumError);
});

test("a frame cut short is rejected", () => {
  const frame = sketchOf(100).toBytes();
  expect(() =>
    HyperLogLog.fromBytes(frame.subarray(0, frame.length - 8)),
  ).toThrow(TruncatedError);
  expect(() => HyperLogLog.fromBytes(new Uint8Array(3))).toThrow(
    SerializationError,
  );
});

test("a sketch round-trips through the JSON envelope", () => {
  for (const sketch of [sketchOf(100), sketchOf(5000)]) {
    const envelope = sketch.toJSON();
    expect(HyperLogLog.fromJSON(envelope).equals(sketch)).toBe(true);
    expect(HyperLogLog.fromJSON(envelope).count()).toBe(sketch.count());

    // Through actual JSON, not just the object it would serialize to.
    const wire = JSON.parse(JSON.stringify(envelope)) as unknown;
    expect(HyperLogLog.fromJSON(wire).equals(sketch)).toBe(true);
  }
});

test("a malformed envelope is rejected", () => {
  const envelope = sketchOf(100).toJSON();

  expect(() => HyperLogLog.fromJSON({ ...envelope, $: "nope" })).toThrow(
    SerializationError,
  );
  expect(() => HyperLogLog.fromJSON({ ...envelope, v: 99 })).toThrow(
    UnknownVersionError,
  );
  expect(() =>
    HyperLogLog.fromJSON({ ...envelope, data: "Z" + envelope.data.slice(1) }),
  ).toThrow(SerializationError);
  expect(() =>
    HyperLogLog.fromJSON({ $: "distillate", v: FORMAT_VERSION }),
  ).toThrow(SerializationError);
  expect(() => HyperLogLog.fromJSON(null)).toThrow(SerializationError);
});

test("a frame naming a hash this release cannot reproduce is rejected", () => {
  const body = new Uint8Array(6 + 12);
  body[0] = 4;
  const frame = writeHeader(
    { version: FORMAT_VERSION, type: 5, flags: 1 },
    body,
  );
  expect(() => HyperLogLog.fromBytes(frame)).toThrow(UnknownHashVariantError);
});

test("a frame naming an encoding this release does not have is rejected", () => {
  const body = new Uint8Array(6 + 12);
  body[0] = 4;
  body[1] = 2;
  const frame = writeHeader(
    { version: FORMAT_VERSION, type: 5, flags: 0 },
    body,
  );
  expect(() => HyperLogLog.fromBytes(frame)).toThrow(SerializationError);
});

test("a frame of another structure is rejected", () => {
  const bloom = new BloomFilter({ m: 64, k: 3 });
  bloom.add("alice");
  expect(() => HyperLogLog.fromBytes(bloom.toBytes())).toThrow(
    SerializationError,
  );
});

// Promotion is at 3 * 2 ** p / 16 entries, so 3 keys at p=4 and 192 at p=10.
// Capping p at 10 against 300 keys is what puts both encodings in range; the
// file's usual p=14 needs 3072 and would only ever produce sparse frames.
const framePrecision = fc.integer({ min: 4, max: 10 });

// Frame offsets, per the published format: 16-byte header, then a 6-byte
// params block, then the payload, then the CRC.
const PAYLOAD_AT = 22;
const CRC_SIZE = 4;
const ENTRY_SIZE = 4;
const RHO_BITS = 6;
const frameKeys = fc.uniqueArray(fc.string(), { maxLength: 300 });

const fromKeys = (keys: readonly string[], p: number): HyperLogLog => {
  const sketch = new HyperLogLog({ p });
  for (const key of keys) sketch.add(key);
  return sketch;
};

test("a generated sketch round-trips in whichever encoding it is in", () => {
  fc.assert(
    fc.property(framePrecision, frameKeys, (p, keys) => {
      const sketch = fromKeys(keys, p);

      expect(HyperLogLog.fromBytes(sketch.toBytes()).equals(sketch)).toBe(true);
    }),
  );

  // Checked, not assumed: the round-trip above is only a claim about both
  // encodings if the generator actually produces both.
  const seen = new Set(
    fc
      .sample(fc.tuple(framePrecision, frameKeys), 200)
      .map(([p, keys]) => fromKeys(keys, p).toBytes()[17]),
  );
  expect([...seen].sort()).toEqual([0, 1]);
});

// Keys have to repeat for this to mean anything: compact only has work to do
// when two adds land on the same sparse index, and a set of distinct keys
// almost never collides at a sparse precision of 25.
const repeatedKeys = fc
  .uniqueArray(fc.string(), { maxLength: 60 })
  .chain((unique) =>
    fc
      .array(fc.integer({ min: 1, max: 4 }), {
        minLength: unique.length,
        maxLength: unique.length,
      })
      .map((times) =>
        unique.flatMap((key, i) => new Array<string>(times[i] ?? 1).fill(key)),
      ),
  );

// What compact guarantees, and the only assertion that notices when it stops:
// round-trip equality survives duplicate entries untouched, because folding to
// dense takes the maximum per register and cannot see them.
test("a sparse frame holds one entry per distinct index", () => {
  fc.assert(
    fc.property(framePrecision, repeatedKeys, (p, keys) => {
      const frame = fromKeys(keys, p).toBytes();
      fc.pre(frame[17] === 1);

      const payload = frame.length - PAYLOAD_AT - CRC_SIZE;
      const view = new DataView(
        frame.buffer,
        frame.byteOffset + PAYLOAD_AT,
        payload,
      );
      const indices = new Set<number>();
      for (let i = 0; i < payload / ENTRY_SIZE; i++) {
        indices.add(view.getUint32(i * ENTRY_SIZE, true) >>> RHO_BITS);
      }

      expect(indices.size).toBe(payload / ENTRY_SIZE);
    }),
  );
});

const denseFrame = (p: number, payload: Uint8Array): Uint8Array => {
  const body = new Uint8Array(6 + payload.length);
  body[0] = p;
  body[1] = 0;
  body.set(payload, 6);
  return writeHeader({ version: FORMAT_VERSION, type: 5, flags: 0 }, body);
};

// Six bits hold 63, but the largest rho a sketch at precision p can record is
// 65 - p. A frame carrying more than that is not one any release wrote, and
// left alone it makes count() diverge: every register saturated sends the
// histogram to all zeros, so the estimator divides by zero and returns
// Infinity, which serializes to null.
test("a frame carrying a register above the precision's maximum is rejected", () => {
  const p = 14;
  const saturated = new Uint8Array((2 ** p * 6) / 8).fill(0xff);

  expect(() => HyperLogLog.fromBytes(denseFrame(p, saturated))).toThrow(
    SerializationError,
  );
});

test("a frame carrying exactly the precision's maximum rho still parses", () => {
  const p = 14;
  const registers = new Registers(p);
  registers.set(0, 65 - p);

  expect(HyperLogLog.fromBytes(denseFrame(p, registers.bytes)).p).toBe(p);
});

const sparseFrame = (p: number, entries: readonly number[]): Uint8Array => {
  const body = new Uint8Array(6 + entries.length * 4);
  body[0] = p;
  body[1] = 1;
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  for (let i = 0; i < entries.length; i++) {
    view.setUint32(6 + i * 4, entries[i] ?? 0, true);
  }
  return writeHeader({ version: FORMAT_VERSION, type: 5, flags: 0 }, body);
};

// Entries are read with getUint32 into an Int32Array, so one with the top bit
// set lands negative and its index runs to 26 bits. That index addresses past
// the registers, the TypedArray drops the write, and the entry disappears on
// the next fold rather than corrupting anything: it counts as a key until
// something makes it dense, then it is gone.
test("a sparse entry outside the 31-bit encoding is rejected", () => {
  expect(() => HyperLogLog.fromBytes(sparseFrame(14, [0xffffffff]))).toThrow(
    SerializationError,
  );
});

test("a sparse entry at the top of the 31-bit encoding still parses", () => {
  expect(HyperLogLog.fromBytes(sparseFrame(14, [0x7fffffff])).count()).toBe(1);
});
