import { expect, test } from "vitest";

import { claimsIn } from "../src/claims.js";

test("an expression statement with a literal comment is a claim", () => {
  expect(claimsIn("hllSizing(0.05).p; // 9")).toEqual([
    { expr: "hllSizing(0.05).p", literal: "9" },
  ]);
});

// The `v: 3` that reached the published site was on a declaration, not a bare
// expression, so this is the shape a checker built on expression statements
// alone would have missed.
test("a lone declaration claims its initialiser", () => {
  expect(claimsIn("const envelope = f.toJSON(); // { v: 4 }")).toEqual([
    { expr: "f.toJSON()", literal: "{ v: 4 }" },
  ]);
});

test("a comment carrying prose after the value is not a claim", () => {
  expect(
    claimsIn("filter.length; // bits currently set, 7 after one key"),
  ).toEqual([]);
});

test("an approximation marker is stripped from the literal", () => {
  expect(claimsIn("fuseBitsPerKey(1_000_000, 8); // ~9.04")).toEqual([
    { expr: "fuseBitsPerKey(1_000_000, 8)", literal: "9.04" },
  ]);
});

// Which of the two the comment refers to is unknowable, so neither is claimed.
test("a multi-declaration statement claims nothing", () => {
  expect(claimsIn("const a = 1, b = 2; // 3")).toEqual([]);
});
