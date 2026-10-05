import { expect, test } from "vitest";

import { interleave } from "../src/isolate.js";

test("interleave merges per-adapter rows by key count, then adapter order", () => {
  expect(
    interleave([
      ["a1", "a2"],
      ["b1", "b2"],
    ]),
  ).toEqual(["a1", "b1", "a2", "b2"]);
  expect(interleave([["a1", "a2"]])).toEqual(["a1", "a2"]);
});
