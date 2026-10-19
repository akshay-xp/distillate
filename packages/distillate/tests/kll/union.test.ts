import { describe, expect, test } from "vitest";

import { KllSketch } from "../../src/kll/kll.js";
import { shuffled } from "../helpers/kll.js";

// Every quantile on a 0.01 grid and every rank at the values and one either
// side: what "answers alike" means here.
function expectSameAnswers(
  actual: KllSketch,
  expected: KllSketch,
  values: readonly number[],
): void {
  expect(actual.count).toBe(expected.count);
  expect(actual.min).toBe(expected.min);
  expect(actual.max).toBe(expected.max);
  for (let i = 0; i <= 100; i++) {
    const q = i / 100;
    expect(actual.quantile(q), `q ${String(q)}`).toBe(expected.quantile(q));
  }
  for (const x of [-1, ...values, Math.max(...values) + 1]) {
    expect(actual.rank(x), `x ${String(x)}`).toBe(expected.rank(x));
  }
}

describe("union below k", () => {
  const values = shuffled(130);
  const build = (): { a: KllSketch; b: KllSketch; both: KllSketch } => {
    const a = new KllSketch({ seed: 1 });
    const b = new KllSketch({ seed: 2 });
    const both = new KllSketch({ seed: 3 });
    values.forEach((v, i) => {
      (i < 60 ? a : b).add(v);
      both.add(v);
    });
    b.add(7, 6);
    b.add(9, 3);
    both.add(7, 6);
    both.add(9, 3);
    return { a, b, both };
  };

  test("answers as one sketch fed both streams", () => {
    const { a, b, both } = build();
    expectSameAnswers(a.union(b), both, values);
    expectSameAnswers(b.union(a), both, values);
  });

  test("leaves both inputs as they were", () => {
    const { a, b } = build();
    const before = [a, b].map((s) => [s.count, s.retained, s.quantile(0.5)]);
    a.union(b);
    expect([a, b].map((s) => [s.count, s.retained, s.quantile(0.5)])).toEqual(
      before,
    );
  });

  test("with an empty side answers as the other", () => {
    const { a } = build();
    const empty = new KllSketch();
    const aValues = values.slice(0, 60);
    expectSameAnswers(a.union(empty), a, aValues);
    expectSameAnswers(empty.union(a), a, aValues);
    const none = empty.union(new KllSketch());
    expect(none.isEmpty).toBe(true);
    expect(none.quantile(0.5)).toBeNaN();
    expect(none.min).toBeNaN();
  });
});
