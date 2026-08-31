import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, expect, test } from "vitest";

import { claimsIn, runClaims } from "../src/claims.js";
import { extractSamples } from "../src/samples.js";

let fixture: string;

function page(...samples: string[]): string {
  const blocks = samples.map((code) => ["```ts", code, "```"].join("\n"));
  return ["---", "title: Fixture", "---", "", ...blocks, ""].join("\n");
}

beforeAll(() => {
  fixture = mkdtempSync(join(tmpdir(), "distillate-claims-"));
});

afterAll(() => {
  rmSync(fixture, { recursive: true, force: true });
});

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

// One sample per claim so a failure names the block it came from, and so the
// correct one proves the checker stays quiet rather than reporting everything.
test("only the claim the library contradicts is reported", async () => {
  const file = join(fixture, "mixed.md");
  writeFileSync(
    file,
    page(
      'import { hllSizing } from "distillate/hll";\n\nhllSizing(0.01).p; // 14',
      'import { hllSizing } from "distillate/hll";\n\nhllSizing(0.05).p; // 12',
    ),
  );

  const failures = await runClaims(extractSamples(file));

  expect(failures).toHaveLength(1);
  const [only] = failures;
  expect(only).toContain("mixed.md");
  expect(only).toContain("hllSizing(0.05).p");
  expect(only).toContain("12");
  expect(only).toContain("9");
});
