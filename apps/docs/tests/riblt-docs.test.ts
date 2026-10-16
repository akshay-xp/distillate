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

/** The text under `### heading`, up to the next heading of depth 2 or 3. */
function subsection(page: string, heading: string): string {
  const at = page.indexOf(`\n### ${heading}\n`);
  if (at === -1) throw new Error(`no "### ${heading}" section`);
  const rest = page.slice(at + 1);
  const end = rest.search(/\n##+ /);
  return end === -1 ? rest : rest.slice(0, end);
}

// Pushing a peer's frame is the reconciliation form of merging with a peer's
// structure, and it fails the same way: the two sides were set up apart.
test("the errors page documents the seed mismatch beside the merge errors", () => {
  const page = read("../src/content/docs/reference/errors.md");
  expect(page).toContain(
    "[`RibltParamMismatchError`](/api/riblt/classes/ribltparammismatcherror/)",
  );
  expect(section(page, "Merge errors")).toContain(
    "### `RibltParamMismatchError`",
  );
  const body = subsection(page, "`RibltParamMismatchError`");
  expect(body).toContain("push");
  expect(body).toContain("seed");
  expect(body).toContain("instanceof RibltParamMismatchError; // true");

  expect(subsection(page, "`ParamError`")).toContain("in order");
});

const guide = (): string => read("../src/content/docs/guides/riblt.md");

test("the RIBLT guide covers what a reader needs to choose and use it", () => {
  const page = guide();
  for (const heading of [
    "Reconcile two sets",
    "When to pick it",
    "Sync over the network",
    "Resolve the remote side",
    "What it costs",
    "Limits",
  ]) {
    section(page, heading);
  }

  const pick = section(page, "When to pick it");
  expect(pick).toContain("Bloom");
  expect(pick).toContain("/guides/choosing-a-structure/");

  const network = section(page, "Sync over the network");
  expect(network).toContain("fetch");
  expect(network).toContain("WebSocket");

  expect(section(page, "Resolve the remote side")).toContain("hashOf");

  // What the overhead gate measured.
  const cost = section(page, "What it costs");
  expect(cost).toContain("1.36");
  expect(cost).toContain("1.81");
  expect(cost).toContain("20 bytes");

  const limits = section(page, "Limits");
  expect(limits).toContain("duplicate");
  expect(limits).toContain("crafted");
  expect(limits).toContain("seed");
  expect(limits).toContain("2.7e-8");
});

test("the sidebar links the RIBLT guide", () => {
  expect(read("../astro.config.mjs")).toContain(
    '{ label: "RIBLT", link: "/guides/riblt/" }',
  );
});
