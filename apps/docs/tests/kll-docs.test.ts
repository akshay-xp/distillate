import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

/** The text under `## heading`, up to the next `## `. */
function section(page: string, heading: string): string {
  const at = page.indexOf(`\n## ${heading}\n`);
  if (at === -1) throw new Error(`no "## ${heading}" section`);
  const end = page.indexOf("\n## ", at + 1);
  return end === -1 ? page.slice(at) : page.slice(at, end);
}

const guide = (): string => read("../src/content/docs/guides/kll.md");

test("the KLL guide covers what a reader needs to choose and use it", () => {
  const page = guide();
  for (const heading of [
    "Rank and quantile",
    "When to pick it",
    "Read the error",
    "Union",
    "Seeds",
    "Persist it",
    "Measured",
    "Limits",
  ]) {
    section(page, heading);
  }
  expect(page.indexOf("\n## Measured\n")).toBeGreaterThan(
    page.indexOf("\n## Persist it\n"),
  );
  expect(page.indexOf("\n## Measured\n")).toBeLessThan(
    page.indexOf("\n## Limits\n"),
  );

  const measured = section(page, "Measured");
  for (const phrase of ["RESULTS.md#kll", "t-digest", "DDSketch"]) {
    expect(measured, phrase).toContain(phrase);
  }

  const pick = section(page, "When to pick it");
  expect(pick).toContain("DDSketch");
  expect(pick).toContain("/guides/choosing-a-structure/#kll-or-ddsketch");

  // What the accuracy gate measured.
  const error = section(page, "Read the error");
  for (const phrase of [
    "normalizedRankError",
    "kllSizing",
    "1.33%",
    "1.65%",
    "0.68",
    "0.55",
    "pooled",
  ]) {
    expect(error, phrase).toContain(phrase);
  }

  expect(section(page, "Union")).toContain("smaller `k`");

  const seeds = section(page, "Seeds");
  for (const phrase of [
    "byte-identical",
    "independent",
    "Cloudflare Workers",
  ]) {
    expect(seeds, phrase).toContain(phrase);
  }

  const persist = section(page, "Persist it");
  for (const phrase of [
    "toBytes",
    "fromBytes",
    "generator state",
    "/reference/serialization/",
  ]) {
    expect(persist, phrase).toContain(phrase);
  }

  const limits = section(page, "Limits");
  for (const phrase of ["NaN", "tails", "3k + 8", "7.4 KiB"]) {
    expect(limits, phrase).toContain(phrase);
  }
});

test("the sidebar links the KLL guide", () => {
  expect(read("../astro.config.mjs")).toContain(
    '{ label: "KLL", link: "/guides/kll/" }',
  );
});

test("the choosing guide routes the rank question to KLL", () => {
  const page = read("../src/content/docs/guides/choosing-a-structure.md");
  // The question list at the top is where a reader is sent first.
  expect(page.slice(0, page.indexOf("## "))).toContain("/guides/kll/");
  expect(section(page, "Decision matrix")).toContain("[KLL](/guides/kll/)");
  expect(section(page, "What ships today")).toContain(
    "### [KLL](/guides/kll/) (`distillate/kll`)",
  );
  const versus = section(page, "KLL or DDSketch");
  for (const phrase of [
    "relative",
    "rank",
    "tails",
    "SLO",
    "[DDSketch](/guides/ddsketch/)",
    "[KLL](/guides/kll/)",
  ]) {
    expect(versus, phrase).toContain(phrase);
  }

  const ddsketch = read("../src/content/docs/guides/ddsketch.md");
  expect(section(ddsketch, "When to pick it")).toContain(
    "/guides/choosing-a-structure/#kll-or-ddsketch",
  );
});

test("the README shows the sketch", () => {
  const readme = read("../../../packages/distillate/README.md");
  const at = readme.indexOf("### KLL (`distillate/kll`)");
  expect(at).toBeGreaterThan(-1);
  const kll = readme.slice(at, readme.indexOf("\n## ", at));
  for (const phrase of [
    "rank(",
    "quantile(",
    "https://distillate.akxp.net/guides/kll/",
  ]) {
    expect(kll, phrase).toContain(phrase);
  }
});
