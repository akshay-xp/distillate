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

test("the errors page lists the union error with a sample that reproduces it", () => {
  const page = read("../src/content/docs/reference/errors.md");
  expect(page).toContain("(/api/ddsketch/classes/ddsketchparammismatcherror/)");
  const at = page.indexOf("\n### `DDSketchParamMismatchError`\n");
  if (at === -1) throw new Error('no "### DDSketchParamMismatchError" section');
  const body = page.slice(at, page.indexOf("\n## ", at));
  expect(body).toContain("DDSketch.union");
  expect(body).toContain("instanceof DDSketchParamMismatchError; // true");
});

test("the choosing guide routes the percentile question to DDSketch", () => {
  const page = read("../src/content/docs/guides/choosing-a-structure.md");
  const matrix = section(page, "Decision matrix");
  expect(matrix).toContain("[DDSketch](/guides/ddsketch/)");
  const ships = section(page, "What ships today");
  expect(ships).toContain(
    "### [DDSketch](/guides/ddsketch/) (`distillate/ddsketch`)",
  );
  // The question list at the top is where a reader is sent first.
  expect(page.slice(0, page.indexOf("## "))).toContain("/guides/ddsketch/");
});

test("the README shows the sketch", () => {
  const readme = read("../../../packages/distillate/README.md");
  expect(readme).toContain("### DDSketch (`distillate/ddsketch`)");
});

// Measured warm on V8, cubic adds about 10% slower than log, quadratic about
// as fast and linear about 7% faster for 44% more bins: Math.log is cheap
// there. The guide once said to reach for cubic when add is hot.
test("the guide does not sell the interpolated mappings as faster", () => {
  const mappings = section(guide(), "Choosing a mapping");
  expect(mappings).not.toMatch(/is hot|reach for/);
  expect(mappings).toContain("Math.log");
  expect(mappings).toContain("Datadog");
});
