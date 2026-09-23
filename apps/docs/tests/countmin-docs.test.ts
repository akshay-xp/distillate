import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const guide = (): string => read("../src/content/docs/guides/countmin.md");

/** The text under `## heading`, up to the next `## `. */
function section(page: string, heading: string): string {
  const at = page.indexOf(`\n## ${heading}\n`);
  if (at === -1) throw new Error(`no "## ${heading}" section`);
  const end = page.indexOf("\n## ", at + 1);
  return end === -1 ? page.slice(at) : page.slice(at, end);
}

test("the Count-Min guide covers what a reader needs to choose and use it", () => {
  const page = guide();
  for (const heading of [
    "Build one",
    "When to pick it",
    "What the bound means",
    "It never underestimates",
    "Repeats are the point",
    "When a counter overflows",
    "Space",
    "Persist it",
  ]) {
    section(page, heading);
  }

  const pick = section(page, "When to pick it");
  expect(pick).toContain("HyperLogLog");
  expect(pick).toContain("how many times");

  const bound = section(page, "What the bound means");
  expect(bound).toContain("epsilon");
  expect(bound).toContain("delta");
  expect(bound).toContain("of the total");

  expect(section(page, "It never underestimates")).toContain("never below");

  // The contrast that trips people: two `from` methods with opposite
  // semantics, each right for its structure.
  const repeats = section(page, "Repeats are the point");
  expect(repeats).toContain("CuckooFilter");
  expect(repeats).toContain("opposite");

  expect(section(page, "When a counter overflows")).toContain(
    "CountMinOverflowError",
  );

  // A sketch's size is fixed before it sees a key, which is the property that
  // separates it from every filter in the library.
  const space = section(page, "Space");
  expect(space).toContain("epsilon");
  expect(space).toContain("delta");
  expect(space).toMatch(/not|never|rather than/);
});

const choosing = (): string =>
  read("../src/content/docs/guides/choosing-a-structure.md");

test("choosing a structure routes the frequency question to Count-Min", () => {
  const page = choosing();

  expect(page).toContain("How many times");
  expect(page).toContain("/guides/countmin/");
  // The matrix is what a reader scans; the question list alone is not enough.
  expect(page).toMatch(/\|.*Count-Min.*\|/);

  // The three families stay distinct: adding a frequency row must not blur
  // the existing claim that no filter answers the cardinality question.
  expect(page).toContain("No filter can answer this");
});
