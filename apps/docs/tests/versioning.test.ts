import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { BloomFilter } from "distillate/bloom";
import { expect, test } from "vitest";

import { parseTable } from "../src/tables.js";

const PAGE = fileURLToPath(
  new URL("../src/content/docs/reference/versioning.md", import.meta.url),
);

function page(): string {
  return readFileSync(PAGE, "utf8");
}

test("the stability contract covers every kind of format change", () => {
  const rows = parseTable(page(), "Format stability contract");

  expect(rows.map((r) => r[0])).toEqual([
    "New structure type",
    "New encoding of an existing type",
    "New header field in reserved space",
    "Hash change",
    "Probe scheme or index mapping change",
    "Payload layout change",
  ]);
  // Only a payload layout change costs a format version; everything else
  // lands additively and is rejected cleanly by an older reader.
  expect(rows.map((r) => r[2])).toEqual(["No", "No", "No", "No", "No", "Yes"]);
});

test("the compatibility model freezes the format version the library writes", () => {
  const text = page();
  const at = text.indexOf("### Compatibility model");
  if (at === -1) throw new Error("versioning.md has no Compatibility model");
  const end = text.indexOf("\n## ", at);
  const section = end === -1 ? text.slice(at) : text.slice(at, end);

  const { v } = new BloomFilter({ m: 64, k: 3 }).toJSON();
  expect(section).toContain("frozen");
  expect(section).toContain("2.0");
  expect(section).toContain(`format version ${String(v)}`);
});
