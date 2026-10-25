import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { HyperLogLog } from "distillate/hll";
import { expect, test } from "vitest";

import { QUERIES } from "../../ranks/src/ranks.js";
import { runClaims } from "../src/claims.js";
import { extractSamples } from "../src/samples.js";
import { pkg, SEARCH_NAME, structureSubpaths } from "./structures.js";

const README = fileURLToPath(
  new URL("../../../packages/distillate/README.md", import.meta.url),
);

/** The keys a sample passes to `add`, in order, with duplicates kept. */
function addedKeys(code: string): string[] {
  return [...code.matchAll(/\.add\("([^"]+)"\)/g)].map((m) => m[1]);
}

// Not a claim check: no comment in the sample states this. What it pins is
// that the sample adds "alice" twice on purpose, and that the point of the
// duplicate still holds. Every number the sample quotes is checked by
// runClaims below.
test("the README HyperLogLog sample counts distinct keys, not additions", () => {
  const sample = extractSamples(README).find((s) =>
    s.code.includes("HyperLogLog"),
  );
  if (!sample) throw new Error("README has no HyperLogLog sample");

  const keys = addedKeys(sample.code);
  expect(keys.length).toBeGreaterThan(new Set(keys).size);

  const sketch = HyperLogLog.create(0.01);
  for (const key of keys) sketch.add(key);

  expect(sketch.count()).toBe(new Set(keys).size);
});

test("every package README sample quotes results the library reproduces", async () => {
  await expect(runClaims(extractSamples(README))).resolves.toEqual([]);
});

test("the README Performance section does not leave the sketch unmentioned", () => {
  const md = readFileSync(README, "utf8");
  const start = md.indexOf("## Performance");
  expect(start).toBeGreaterThan(-1);
  const section = md.slice(start, md.indexOf("\n## ", start + 1));
  expect(section).toMatch(/cardinality|HyperLogLog/i);
});

// Driven by the package's own exports, so the next structure cannot ship
// without a row either.
test("the README structures table lists every structure subpath", () => {
  const structures = structureSubpaths.map(
    (key) => `distillate/${key.slice(2)}`,
  );

  const readme = readFileSync(README, "utf8");
  const table = readme.slice(
    readme.indexOf("## Structures"),
    readme.indexOf("\n### ", readme.indexOf("## Structures")),
  );
  const listed = [...table.matchAll(/^\| `(distillate\/[a-z]+)`/gm)].map(
    (m) => m[1],
  );
  for (const subpath of structures) expect(listed).toContain(subpath);
  expect(readme).toContain("### Scalable Bloom (`distillate/scalable`)");
});

test("the README describes Cuckoo and no longer lists shipped structures as coming", () => {
  const readme = readFileSync(README, "utf8");
  expect(readme).toContain("### Cuckoo (`distillate/cuckoo`)");

  const note = readme.slice(
    readme.indexOf("> **Pre-release"),
    readme.indexOf("\n\n", readme.indexOf("> **Pre-release")),
  );
  expect(note).not.toContain("Cuckoo");
  expect(note).not.toContain("Scalable Bloom");
});

// npm search matches on name, keywords and description, and "distillate" holds
// no query term, so each structure must be findable by the name people search.
// Keyed by subpath, so the next structure cannot ship without a keyword.
test("every structure subpath has its search name among the npm keywords", () => {
  for (const subpath of structureSubpaths) {
    const name = SEARCH_NAME[subpath];
    expect(name, `${subpath} has no search name`).toBeDefined();
    expect(pkg.keywords, subpath).toContain(name);
  }
  expect(new Set(pkg.keywords).size).toBe(pkg.keywords.length);
});

// npm search does not stem: "bloom filters" and "bloom filter" return
// different results. So every word of every tracked query must appear in the
// description as typed, singular included. The queries are the tracker's own.
test("the npm description holds every word of every tracked search query", () => {
  const words = new Set(pkg.description.toLowerCase().match(/[a-z0-9]+/g));
  for (const query of [...QUERIES, "xor filter"]) {
    for (const word of query.match(/[a-z0-9]+/g) ?? []) {
      expect(words, `"${word}" of "${query}"`).toContain(word);
    }
  }
  expect(pkg.description.length).toBeLessThan(300);
});

const ROOT_README = fileURLToPath(
  new URL("../../../README.md", import.meta.url),
);

/** The `## Structures` table: its header row through its last row. */
function structuresTable(md: string): string {
  const section = md.slice(md.indexOf("## Structures"));
  const table = section.slice(section.indexOf("| Import"));
  return table.slice(0, table.search(/\n(?!\|)/));
}

// GitHub shows the root README and npm the package's, so both lead with every
// structure, and the root carries the package's table rather than its own.
test("the root README carries the package README's structures table", () => {
  const table = structuresTable(readFileSync(README, "utf8"));
  expect(table).toContain("`distillate/kll`");

  expect(readFileSync(ROOT_README, "utf8")).toContain(table);
});

test("neither README still says it is filters only", () => {
  for (const path of [README, ROOT_README]) {
    const md = readFileSync(path, "utf8");
    expect(md, path).not.toContain("opens with a family of membership filters");
    expect(md, path).not.toContain(
      "approximate-membership filters (Bloom, Blocked Bloom, Binary Fuse)",
    );
  }
});
