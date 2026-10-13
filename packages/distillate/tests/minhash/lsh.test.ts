import { describe, expect, test } from "vitest";

import { ParamError } from "../../src/core/params.js";
import { MinHashLSH } from "../../src/minhash/lsh.js";
import { lshSizing } from "../../src/minhash/sizing.js";

describe("construction", () => {
  test("defaults to 128 slots, seed 0, and the balanced split", () => {
    const lsh = new MinHashLSH({ threshold: 0.5 });
    expect(lsh.bands).toBe(25);
    expect(lsh.rows).toBe(5);
    expect(lsh.threshold).toBe(0.5);
    expect(lsh.k).toBe(128);
    expect(lsh.seed).toBe(0);
    expect(lsh.size).toBe(0);
  });

  test("takes its split from lshSizing", () => {
    const lsh = new MinHashLSH({ threshold: 0.7, k: 256, weights: [0.3, 0.7] });
    const { bands, rows } = lshSizing(0.7, 256, [0.3, 0.7]);
    expect(lsh.bands).toBe(bands);
    expect(lsh.rows).toBe(rows);
  });

  test("rejects a threshold outside (0, 1) and a seed outside u32", () => {
    expect(() => new MinHashLSH({ threshold: 1 })).toThrow(ParamError);
    expect(() => new MinHashLSH({ threshold: 0.5, seed: -1 })).toThrow(
      ParamError,
    );
  });
});
