import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const guide = (): string => read("../src/content/docs/guides/ddsketch.md");

/** The text under `## heading`, up to the next `## `. */
function section(page: string, heading: string): string {
  const at = page.indexOf(`\n## ${heading}\n`);
  if (at === -1) throw new Error(`no "## ${heading}" section`);
  const end = page.indexOf("\n## ", at + 1);
  return end === -1 ? page.slice(at) : page.slice(at, end);
}

test("the DDSketch guide covers what a reader needs to choose and use it", () => {
  const page = guide();
  for (const heading of [
    "Build one",
    "When to pick it",
    "What relative accuracy means",
    "Choosing a mapping",
    "Choosing a store",
    "Union",
    "Persist it",
    "Send it to Datadog",
  ]) {
    section(page, heading);
  }

  // The alternative a reader most likely has in mind, and why this is not it.
  const pick = section(page, "When to pick it");
  expect(pick).toContain("t-digest");
  expect(pick).toContain("/guides/choosing-a-structure/");

  const accuracy = section(page, "What relative accuracy means");
  expect(accuracy).toContain("relativeAccuracy");
  expect(accuracy).toContain("tails");

  const mappings = section(page, "Choosing a mapping");
  for (const name of [
    "logMapping",
    "linearMapping",
    "quadraticMapping",
    "cubicMapping",
  ]) {
    expect(mappings).toContain(name);
  }

  // What #282 found: the default bound is sized for 1%, not for 0.1%.
  const stores = section(page, "Choosing a store");
  expect(stores).toContain("collapsingLowestStore");
  expect(stores).toContain("maxBins");
  expect(stores).toContain("0.001");

  expect(section(page, "Union")).toContain("DDSketchParamMismatchError");
  expect(section(page, "Persist it")).toContain("toBytes");

  // The message has no field for them, so a reader must not expect them back.
  const datadog = section(page, "Send it to Datadog");
  expect(datadog).toContain("distillate/ddsketch/protobuf");
  expect(datadog).toContain("derived");
});
