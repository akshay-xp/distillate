import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

import { entriesOf, publishedEntries } from "../scripts/entries.mjs";

const pkgDir = fileURLToPath(new URL("..", import.meta.url));

const esm = (dir: string) => ({
  types: { import: `./dist/${dir}index.d.ts` },
  import: `./dist/${dir}index.js`,
  require: `./dist/${dir}index.cjs`,
});

// Every list of entry points is derived from here, so a subpath added to
// exports reaches the build, the API report, the docs gate and the reference
// with no other edit.
test("a subpath added to exports becomes an entry with no other edit", () => {
  expect(
    entriesOf({
      ".": esm(""),
      "./alpha": esm("alpha/"),
      "./package.json": "./package.json",
    }),
  ).toEqual([
    {
      subpath: ".",
      name: "distillate",
      src: "src/index.ts",
      dts: "dist/index.d.ts",
    },
    {
      subpath: "./alpha",
      name: "alpha",
      src: "src/alpha/index.ts",
      dts: "dist/alpha/index.d.ts",
    },
  ]);
});

test("the package's own exports give every published entry, in order", () => {
  const entries = publishedEntries();

  expect(entries.map((e) => e.name)).toEqual([
    "distillate",
    "bloom",
    "blocked",
    "fuse",
    "hll",
    "frame",
    "scalable",
    "cuckoo",
    "countmin",
    "topk",
  ]);
  for (const { src } of entries) {
    expect(existsSync(`${pkgDir}/${src}`), src).toBe(true);
  }
});
