import { expect, test } from "vitest";

import { TopK, TopKParamMismatchError } from "../../src/topk/topk.js";

// A differing seed matters as much as a differing capacity: the same key would
// hash elsewhere, and the error naming both values says which side to rebuild.
test.each<[string, TopK, RegExp]>([
  ["capacity", new TopK({ capacity: 32 }), /capacity 16 and 32/],
  ["seed", new TopK({ capacity: 16, seed: 7 }), /seed 0 and 7/],
])("a union across a differing %s is refused", (_, other, message) => {
  const a = new TopK({ capacity: 16 });

  expect(() => a.union(other)).toThrow(TopKParamMismatchError);
  expect(() => a.union(other)).toThrow(message);
});
