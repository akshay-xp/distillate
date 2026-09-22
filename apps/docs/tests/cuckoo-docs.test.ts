import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

import { parseTable } from "../src/tables.js";

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const guide = (): string => read("../src/content/docs/guides/cuckoo.md");

/** The text under `## heading`, up to the next `## `. */
function section(page: string, heading: string): string {
  const at = page.indexOf(`\n## ${heading}\n`);
  if (at === -1) throw new Error(`no "## ${heading}" section`);
  const end = page.indexOf("\n## ", at + 1);
  return end === -1 ? page.slice(at) : page.slice(at, end);
}

test("the Cuckoo guide covers what a reader needs to choose and use it", () => {
  const page = guide();
  for (const heading of [
    "Build one",
    "When to pick it",
    "Delete",
    "Only delete what you added",
    "When it is full",
    "Space",
    "Persist it",
  ]) {
    section(page, heading);
  }

  const pick = section(page, "When to pick it");
  expect(pick).toContain("delete");
  expect(pick).toContain("BloomFilter");
  // Two adds of one key, then a delete after which it is still present.
  const del = section(page, "Delete");
  expect(del.match(/\.add\("alice"\)/g)).toHaveLength(2);
  expect(del.match(/\.delete\("alice"\)/g)?.length).toBeGreaterThanOrEqual(2);
  expect(section(page, "Only delete what you added")).toContain(
    "false negative",
  );
  const full = section(page, "When it is full");
  expect(full).toContain("CuckooFullError");
  expect(full).toContain("unchanged");
  // Measured: still larger than Bloom at 0.25% (12.78 vs 12.47 bits/key),
  // smaller from 0.2% (12.78 vs 12.93).
  expect(section(page, "Space")).toContain("0.2%");
});

test("the sidebar links the Cuckoo guide", () => {
  expect(read("../astro.config.mjs")).toContain('"/guides/cuckoo/"');
});

const chooser = (): string =>
  read("../src/content/docs/guides/choosing-a-structure.md");

test("the chooser routes inserts and deletes to Cuckoo", () => {
  const rows = parseTable(chooser(), "Decision matrix");
  const use = rows.find(([w]) => w.startsWith("Inserts and deletes"))?.[1];
  expect(use).toContain("[Cuckoo](/guides/cuckoo/)");
  expect(use).not.toContain("not yet available");
});

test("the chooser lists Cuckoo as shipped and no longer says there is no delete", () => {
  const page = chooser();
  expect(section(page, "What ships today")).toContain(
    "### [Cuckoo](/guides/cuckoo/) (`distillate/cuckoo`)",
  );
  expect(section(page, "What is not shipped yet")).not.toContain("**Cuckoo**");
  expect(page).not.toContain("no delete anywhere");
});

const errors = (): string => read("../src/content/docs/reference/errors.md");

test("the errors reference documents CuckooFullError under capacity errors", () => {
  const page = errors();
  expect(page).toContain(
    "[`CuckooFullError`](/api/cuckoo/classes/cuckoofullerror/)",
  );
  expect(section(page, "Capacity errors")).toContain("### `CuckooFullError`");
  // One group per `## ... errors` section, which the intro has to count.
  const groups = page.match(/^## \w+ errors$/gm) ?? [];
  expect(groups).toHaveLength(5);
  expect(page).toMatch(/fall into five groups/);
});

// It merges, it does not build: it belongs beside the other mismatch errors.
test("the scalable mismatch error sits with the merge errors", () => {
  const page = errors();
  expect(section(page, "Merge errors")).toContain(
    "### `ScalableParamMismatchError`",
  );
  expect(section(page, "Build errors")).not.toContain(
    "ScalableParamMismatchError",
  );
});
