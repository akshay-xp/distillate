import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

import { parseTable } from "../src/tables.js";

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

const chooser = (): string =>
  read("../src/content/docs/guides/choosing-a-structure.md");

test("the chooser routes an unknown key count to Scalable Bloom", () => {
  const rows = parseTable(chooser(), "Decision matrix");
  const row = rows.find(([workload]) =>
    workload.startsWith("Unbounded growth"),
  );
  const use = row?.[1] ?? "";
  expect(use).toContain("[Scalable Bloom](/guides/scalable/)");
  // Only the expandable filters after it are still unshipped.
  expect(use.split("InfiniFilter")[0]).not.toContain("not yet available");
});

test("the chooser lists Scalable Bloom as shipped, not as planned", () => {
  const page = chooser();
  const shipped = section(page, "What ships today");
  const planned = section(page, "What is not shipped yet");
  expect(shipped).toContain("### [Scalable Bloom](/guides/scalable/)");
  expect(planned).not.toContain("Scalable Bloom");
});

const errors = (): string => read("../src/content/docs/reference/errors.md");

const NUMBERS = ["ten", "eleven", "twelve", "thirteen", "fourteen"];

test("the errors reference documents ScalableParamMismatchError", () => {
  const page = errors();
  expect(page).toContain(
    "[`ScalableParamMismatchError`](/api/scalable/classes/scalableparammismatcherror/)",
  );
  expect(page).toContain("### `ScalableParamMismatchError`");
});

test("the errors reference's class count matches its table", () => {
  const page = errors();
  const rows = page.split("\n").filter((line) => line.startsWith("| [`"));
  const said = /exports (\w+) error classes/.exec(page)?.[1];
  expect(said).toBe(NUMBERS[rows.length - 10]);
});

test("the errors reference says which subpaths export what", () => {
  const page = errors();
  const at = page.indexOf("serialization errors are exported");
  const paragraph = page.slice(at, page.indexOf("\n\n", at));
  expect(paragraph).toContain("six structure subpaths");
  expect(paragraph).toContain("distillate/scalable");
  for (const subpath of ["bloom", "blocked", "hll", "scalable", "cuckoo"]) {
    expect(paragraph, subpath).toContain(`\`distillate/${subpath}\``);
  }
});
