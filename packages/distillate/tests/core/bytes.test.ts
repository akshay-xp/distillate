import { afterEach, expect, test, vi } from "vitest";

import { encodedBytes, encodeKey, normalize } from "../../src/core/bytes.js";

afterEach(() => {
  vi.restoreAllMocks();
});

test("normalize encodes strings as UTF-8", () => {
  expect(normalize("hi")).toEqual(new Uint8Array([104, 105]));
  expect(normalize("é")).toEqual(new Uint8Array([0xc3, 0xa9]));
  expect(normalize("")).toEqual(new Uint8Array([]));
});

test("normalize returns a Uint8Array view's bytes without over-reading", () => {
  const buf = new Uint8Array([9, 1, 2, 3, 9]);
  const view = buf.subarray(1, 4);
  expect(normalize(view)).toEqual(new Uint8Array([1, 2, 3]));
});

test("normalize wraps an ArrayBuffer and matches other input forms", () => {
  const ab = Uint8Array.of(65, 66).buffer;
  expect(normalize(ab)).toEqual(new Uint8Array([65, 66]));

  const fromString = normalize("AB");
  const fromArray = normalize(Uint8Array.of(65, 66));
  const fromBuffer = normalize(ab);
  expect(fromString).toEqual(fromArray);
  expect(fromArray).toEqual(fromBuffer);
});

test("encodeKey writes the same UTF-8 bytes as TextEncoder for any string", () => {
  const pools = ["abcxyz09:-.", "é漢😀a", "\ud800a\udc00b"];
  let seed = 1;
  const rnd = (): number =>
    (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32;
  const strings = ["abc\ud800", "", "a😀b", "ab😀"];
  for (let n = 0; n < 5000; n++) {
    const pool = pools[n % pools.length] ?? "";
    let s = "";
    for (let i = Math.floor(rnd() * 21); i > 0; i--) {
      s += pool.charAt(Math.floor(rnd() * pool.length));
    }
    strings.push(s);
  }
  const reference = new TextEncoder();
  for (const s of strings) {
    const len = encodeKey(s);
    expect(encodedBytes().subarray(0, len), JSON.stringify(s)).toEqual(
      reference.encode(s),
    );
  }
});

test("encodeKey copies ASCII strings of up to 12 chars without encodeInto", () => {
  const spy = vi.spyOn(TextEncoder.prototype, "encodeInto");
  encodeKey("abcdefghijkl");
  expect(spy).not.toHaveBeenCalled();
  encodeKey("abcdefghijklm");
  expect(spy).toHaveBeenCalledTimes(1);
  encodeKey("abé");
  expect(spy).toHaveBeenCalledTimes(2);
});
