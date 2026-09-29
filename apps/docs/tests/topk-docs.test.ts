import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const guide = (): string => read("../src/content/docs/guides/topk.md");

/** The text under `## heading`, up to the next `## `. */
function section(page: string, heading: string): string {
  const at = page.indexOf(`\n## ${heading}\n`);
  if (at === -1) throw new Error(`no "## ${heading}" section`);
  const end = page.indexOf("\n## ", at + 1);
  return end === -1 ? page.slice(at) : page.slice(at, end);
}

test("the Top-K guide covers what a reader needs to choose and use it", () => {
  const page = guide();
  for (const heading of [
    "Build one",
    "When to pick it",
    "What the bound means",
    "It never underestimates",
    "Keys come back as bytes",
    "The frame holds your keys",
    "Union is not the combined stream",
    "Space",
    "Persist it",
  ]) {
    section(page, heading);
  }

  // The question it answers is the one Count-Min cannot: which keys, unnamed.
  const pick = section(page, "When to pick it");
  expect(pick).toContain("Count-Min");
  expect(pick).toContain("/guides/countmin/");

  const bound = section(page, "What the bound means");
  expect(bound).toContain("epsilon");
  expect(bound).toContain("of the total");
  expect(bound).toContain("error()");

  const never = section(page, "It never underestimates");
  expect(never).toContain("lowerBound");
  expect(never).toContain("never below");
  expect(never).toContain("TopKOverflowError");

  const bytes = section(page, "Keys come back as bytes");
  expect(bytes).toContain("Uint8Array");
  expect(bytes).toContain("TextDecoder");

  // Every other frame is one-way; this one persists user input, which is the
  // point a reader serialising into a cache or a log must not miss.
  const frame = section(page, "The frame holds your keys");
  expect(frame).toContain("verbatim");
  expect(frame).toContain("Count-Min");
  expect(frame).toContain("toBytes");

  // The departure from Count-Min's byte-exact union, with the reason.
  const union = section(page, "Union is not the combined stream");
  expect(union).toContain("Count-Min");
  expect(union).toContain("order");
  expect(union).toContain("equals");

  const space = section(page, "Space");
  expect(space).toContain("capacity");
  expect(space).toMatch(/rather than|not/);
});

const choosing = (): string =>
  read("../src/content/docs/guides/choosing-a-structure.md");

test("choosing a structure routes the heavy-hitters question to Top-K", () => {
  const page = choosing();

  expect(page).toContain("/guides/topk/");
  // The matrix is what a reader scans; the question list alone is not enough.
  expect(page).toMatch(/\|.*Top-K.*\|/);
  expect(section(page, "What ships today")).toContain(
    "### [Top-K](/guides/topk/)",
  );

  const planned = section(page, "What is not shipped yet");
  expect(planned).not.toContain("heavy");
  expect(planned).not.toContain("Top-K");
});

test("the Count-Min guide points to Top-K rather than calling it unshipped", () => {
  const countmin = read("../src/content/docs/guides/countmin.md");
  const pick = section(countmin, "When to pick it");

  expect(pick).toContain("/guides/topk/");
  expect(pick).not.toContain("not shipped");
});

const errors = (): string => read("../src/content/docs/reference/errors.md");

// Count-Min's errors never reached this page either, and adding only Top-K's
// would leave its counts wrong in a new way, so both sketches are pinned.
test("the errors reference documents the Count-Min and Top-K errors", () => {
  const page = errors();
  for (const [subpath, name] of [
    ["countmin", "CountMinParamMismatchError"],
    ["countmin", "CountMinOverflowError"],
    ["topk", "TopKParamMismatchError"],
    ["topk", "TopKOverflowError"],
  ]) {
    expect(page).toContain(
      `[\`${name}\`](/api/${subpath}/classes/${name.toLowerCase()}/)`,
    );
  }

  const merge = section(page, "Merge errors");
  expect(merge).toContain("### `CountMinParamMismatchError`");
  expect(merge).toContain("### `TopKParamMismatchError`");
  const capacity = section(page, "Capacity errors");
  expect(capacity).toContain("### `CountMinOverflowError`");
  expect(capacity).toContain("### `TopKOverflowError`");
});

test("the README shows Top-K in use and links its guide", () => {
  const readme = read("../../../packages/distillate/README.md");
  const at = readme.indexOf("### Top-K (`distillate/topk`)");

  expect(at).toBeGreaterThan(-1);
  expect(readme.slice(at, readme.indexOf("\n## ", at))).toContain(
    "/guides/topk/",
  );
});

test("no page describes a Top-K seed, which the sketch no longer has", () => {
  const errors = read("../src/content/docs/reference/errors.md");
  const row = errors
    .split("\n")
    .find((line) => line.includes("`TopKParamMismatchError`"));
  expect(row).toContain("capacity");
  expect(row).not.toMatch(/seed/i);
  const entry = section(errors, "Merge errors").split(
    "### `TopKParamMismatchError`",
  )[1];
  expect(entry.split("\n### ")[0]).not.toMatch(/seed/i);

  expect(guide()).not.toMatch(/seed/i);
});

test("the type 9 reference names the bound a reader enforces", () => {
  const reference = read("../src/content/docs/reference/serialization.md");
  const topK = reference.slice(
    reference.indexOf("Top-K (type 9), little-endian"),
  );
  const rejects = topK.slice(
    topK.indexOf("A reader rejects:"),
    topK.indexOf("\n\n", topK.indexOf("A reader rejects:") + 20),
  );
  expect(rejects).toContain("sum(counts) + W * offset");
  expect(topK.split("\n### ")[0]).not.toMatch(/\bseed\b/);
});

test("the guide says why untrusted keys are safe and where a Worker builds one", () => {
  const untrusted = section(guide(), "Untrusted keys");
  expect(untrusted).toContain("HalfSipHash");
  expect(untrusted).toMatch(/no option/i);
  expect(untrusted).toContain("Cloudflare Workers");

  const runtimes = read("../src/content/docs/guides/cross-runtime.md");
  expect(runtimes).toContain("Cloudflare Workers");
  expect(runtimes).toContain("/guides/topk/");
});

test("the Space section describes a table that grows to capacity", () => {
  const space = section(guide(), "Space");
  expect(space).toContain("doubles");
  expect(space).toContain("at most");
});
