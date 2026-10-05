import { expect, test } from "vitest";

import type { CuckooRow } from "../src/cuckoo.js";
import { interleave, runIsolated } from "../src/isolate.js";

test("interleave merges per-adapter rows by key count, then adapter order", () => {
  expect(
    interleave([
      ["a1", "a2"],
      ["b1", "b2"],
    ]),
  ).toEqual(["a1", "b1", "a2", "b2"]);
  expect(interleave([["a1", "a2"]])).toEqual(["a1", "a2"]);
});

test("runIsolated measures one adapter's section in a separate process", () => {
  const { pid, rows } = runIsolated<CuckooRow>("cuckoo", "distillate/cuckoo", [
    [1000],
  ]);
  expect(pid).not.toBe(process.pid);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ name: "distillate/cuckoo", keys: 1000 });
});

test("runIsolated names an adapter the section does not have", () => {
  expect(() => runIsolated("cuckoo", "no-such-filter", [[1000]])).toThrow(
    /no-such-filter/,
  );
});
