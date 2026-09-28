import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const guide = (): string => read("../src/content/docs/guides/topk.md");

/** The text under `## heading`, up to the next `## `. */
function section(page: string, heading: string): string {
  const at = page.indexOf(`\n## ${heading}\n`);
  if (at === -1) throw new Error(`no "## ${heading}" section`);
  const end = page.indexOf("\n## ", at + 1);
  return end === -1 ? page.slice(at) : page.slice(at, end);
}

test("the Top-K guide covers what a reader needs to choose and use it", () => {
  const page = guide();
  for (const heading of [
    "Build one",
    "When to pick it",
    "What the bound means",
    "It never underestimates",
  ]) {
    section(page, heading);
  }

  // The question it answers is the one Count-Min cannot: which keys, unnamed.
  const pick = section(page, "When to pick it");
  expect(pick).toContain("Count-Min");
  expect(pick).toContain("/guides/countmin/");

  const bound = section(page, "What the bound means");
  expect(bound).toContain("epsilon");
  expect(bound).toContain("of the total");
  expect(bound).toContain("error()");

  const never = section(page, "It never underestimates");
  expect(never).toContain("lowerBound");
  expect(never).toContain("never below");
  expect(never).toContain("TopKOverflowError");
});
