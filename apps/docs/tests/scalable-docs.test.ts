import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const guide = (): string => read("../src/content/docs/guides/scalable.md");

/** The text under `## heading`, up to the next `## `. */
function section(page: string, heading: string): string {
  const at = page.indexOf(`\n## ${heading}\n`);
  if (at === -1) throw new Error(`no "## ${heading}" section`);
  const end = page.indexOf("\n## ", at + 1);
  return end === -1 ? page.slice(at) : page.slice(at, end);
}

test("the Scalable Bloom guide covers what a reader needs to choose and use it", () => {
  const page = guide();
  for (const heading of [
    "Build one",
    "When to pick it",
    "Growth and tightening",
    "The false-positive bound",
    "Re-adding a key",
    "The size ceiling",
    "Merge two filters",
    "Persist it",
  ]) {
    section(page, heading);
  }

  expect(section(page, "When to pick it")).toContain("BloomFilter");
  expect(section(page, "When to pick it")).toContain("`n`");
  const knobs = section(page, "Growth and tightening");
  for (const word of ["growth", "tightening", "`2`", "`0.85`"]) {
    expect(knobs, word).toContain(word);
  }
  expect(section(page, "The false-positive bound")).toContain(
    "epsilon * (1 - tightening)",
  );
  expect(section(page, "The size ceiling")).toContain("RangeError");
});

test("the sidebar links the Scalable Bloom guide", () => {
  expect(read("../astro.config.mjs")).toContain('"/guides/scalable/"');
});
