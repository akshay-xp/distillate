import { expect, test } from "vitest";

import { forEachItem, toArray } from "../../src/core/iterable.js";

test("forEachItem visits an array's items in order", () => {
  const seen: string[] = [];
  forEachItem(["a", "b", "c"], (item) => seen.push(item));

  expect(seen).toEqual(["a", "b", "c"]);
});

// A builder fed a generator must not hold its whole output at once.
test("forEachItem streams an iterable rather than collecting it first", () => {
  const log: string[] = [];
  function* generate(): Generator<string> {
    for (const item of ["a", "b"]) {
      log.push(`yield ${item}`);
      yield item;
    }
  }
  forEachItem(generate(), (item) => log.push(`saw ${item}`));

  expect(log).toEqual(["yield a", "saw a", "yield b", "saw b"]);
});

test("toArray returns an array argument without copying it", () => {
  const items = ["a", "b"];

  expect(toArray(items)).toBe(items);
});

test("toArray collects any other iterable in order", () => {
  expect(toArray(new Set(["b", "a", "b", "c"]))).toEqual(["b", "a", "c"]);
});
