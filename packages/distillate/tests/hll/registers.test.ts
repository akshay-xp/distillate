import fc from "fast-check";
import { expect, test } from "vitest";

import { Registers } from "../../src/hll/registers.js";

test("byteLength packs six bits per register", () => {
  for (const p of [4, 14, 18]) {
    expect(new Registers(p).bytes.byteLength).toBe((3 * 2 ** p) / 4);
  }
  expect(new Registers(14).bytes.byteLength).toBe(12288);
});

test("a fresh store reads zero at every index", () => {
  const r = new Registers(6);
  for (let i = 0; i < 2 ** 6; i++) expect(r.get(i)).toBe(0);
});

test("every written value reads back unchanged (property)", () => {
  const p = 8;
  const m = 2 ** p;
  fc.assert(
    fc.property(
      fc.array(fc.tuple(fc.nat({ max: m - 1 }), fc.nat({ max: 63 })), {
        maxLength: 400,
      }),
      (writes) => {
        const r = new Registers(p);
        const expected = new Uint8Array(m);
        for (const [i, v] of writes) {
          r.set(i, v);
          expected[i] = v;
        }
        for (let i = 0; i < m; i++) expect(r.get(i)).toBe(expected[i]);
      },
    ),
  );
});

test("the final register round-trips, including the tail byte", () => {
  for (const p of [4, 14, 18]) {
    const r = new Registers(p);
    const last = 2 ** p - 1;
    r.set(last, 63);
    expect(r.get(last)).toBe(63);
    expect(r.get(last - 1)).toBe(0);
  }
});

test("writing a register leaves its neighbours untouched", () => {
  const r = new Registers(8);
  for (let i = 1; i < 255; i++) {
    const before = [r.get(i - 1), r.get(i + 1)];
    r.set(i, 63);
    expect(r.get(i)).toBe(63);
    expect([r.get(i - 1), r.get(i + 1)]).toEqual(before);
    r.set(i, 0);
  }
});

test("max reports the largest value held", () => {
  expect(new Registers(8).max()).toBe(0);

  const saturated = new Registers(8);
  saturated.set(0, 63);
  expect(saturated.max()).toBe(63);

  const mixed = new Registers(8);
  mixed.set(5, 12);
  mixed.set(9, 40);
  expect(mixed.max()).toBe(40);
});

// Pinned against get(), which max unpacks four registers at a time to avoid.
// The two have to agree or the faster path is reading the packing wrong.
test("max agrees with a scan through get (property)", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 4, max: 10 }),
      fc.array(fc.tuple(fc.nat({ max: 1023 }), fc.nat({ max: 63 })), {
        maxLength: 200,
      }),
      (p, writes) => {
        const m = 2 ** p;
        const r = new Registers(p);
        for (const [i, v] of writes) r.set(i % m, v);

        let expected = 0;
        for (let i = 0; i < m; i++) expected = Math.max(expected, r.get(i));

        expect(r.max()).toBe(expected);
      },
    ),
  );
});
