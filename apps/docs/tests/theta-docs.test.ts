import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

test("the README shows the sketch", () => {
  const readme = read("../../../packages/distillate/README.md");
  expect(readme).toContain("### Theta (`distillate/theta`)");
});

/** The text under `## heading`, up to the next `## `. */
function section(page: string, heading: string): string {
  const at = page.indexOf(`\n## ${heading}\n`);
  if (at === -1) throw new Error(`no "## ${heading}" section`);
  const end = page.indexOf("\n## ", at + 1);
  return end === -1 ? page.slice(at) : page.slice(at, end);
}

const guide = (): string => read("../src/content/docs/guides/theta.md");

test("the Theta guide covers what a reader needs to choose and use it", () => {
  const page = guide();
  for (const heading of [
    "Count and combine",
    "When to pick it",
    "Set operations",
    "Read the bounds",
    "Persist it",
    "Limits",
  ]) {
    section(page, heading);
  }

  const pick = section(page, "When to pick it");
  expect(pick).toContain("HyperLogLog");
  expect(pick).toContain("inclusion-exclusion");
  expect(pick).toContain("/guides/choosing-a-structure/");

  const ops = section(page, "Set operations");
  for (const word of ["union", "intersect", "difference", "smaller `k`"]) {
    expect(ops, word).toContain(word);
  }

  // What the accuracy gate measured.
  const bounds = section(page, "Read the bounds");
  for (const phrase of ["lowerBound", "upperBound", "pooled", "95.7", "99.8"]) {
    expect(bounds, phrase).toContain(phrase);
  }

  const limits = section(page, "Limits");
  for (const phrase of ["112 KiB", "seed", "2^53"]) {
    expect(limits, phrase).toContain(phrase);
  }
});

test("the sidebar links the Theta guide", () => {
  expect(read("../astro.config.mjs")).toContain(
    '{ label: "Theta", link: "/guides/theta/" }',
  );
});
