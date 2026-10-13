import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const guide = (): string => read("../src/content/docs/guides/minhash.md");

/** The text under `## heading`, up to the next `## `. */
function section(page: string, heading: string): string {
  const at = page.indexOf(`\n## ${heading}\n`);
  if (at === -1) throw new Error(`no "## ${heading}" section`);
  const end = page.indexOf("\n## ", at + 1);
  return end === -1 ? page.slice(at) : page.slice(at, end);
}

test("the MinHash guide covers what a reader needs to choose and use it", () => {
  const page = guide();
  for (const heading of [
    "Build one",
    "When to pick it",
    "What the estimate means",
    "Union",
    "Persist it",
    "Find near-duplicates",
    "Limits",
  ]) {
    section(page, heading);
  }

  // The sketch a reader most likely confuses it with, and the way out.
  const pick = section(page, "When to pick it");
  expect(pick).toContain("HyperLogLog");
  expect(pick).toContain("/guides/choosing-a-structure/");

  // What the accuracy gate measured: densification costs small sets.
  const estimate = section(page, "What the estimate means");
  expect(estimate).toContain("standardError");
  expect(estimate).toContain("0.5 / sqrt(k)");
  expect(estimate).toContain("smaller than `k`");
  expect(estimate).toContain("1.3");

  expect(section(page, "Persist it")).toContain("toBytes");

  // The S-curve does not cut cleanly at the threshold, and candidates are
  // candidates: the guide must say both.
  const lsh = section(page, "Find near-duplicates");
  expect(lsh).toContain("MinHashLSH");
  expect(lsh).toContain("lshSizing");
  expect(lsh).toContain("jaccard");
  expect(lsh).toContain("87%");

  const limits = section(page, "Limits");
  expect(limits).toContain("crafted");
  expect(limits).toContain("seed");
});

test("the sidebar links the MinHash guide", () => {
  expect(read("../astro.config.mjs")).toContain(
    '{ label: "MinHash", link: "/guides/minhash/" }',
  );
});
