// Fails the build when the site links to a page it never emitted. Run after
// build: `pnpm links:check [dir]`, defaulting to `dist`.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { findBrokenLinks } from "./links.mjs";

const root = process.argv[2] ?? "dist";

/** @param {string} dir @returns {string[]} */
function htmlFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return htmlFiles(path);
    return entry.name.endsWith(".html") ? [path] : [];
  });
}

/** Astro emits `<route>/index.html`, so the directory is the route. */
const pages = new Map(
  htmlFiles(root).map((file) => {
    const dir = relative(root, file).split(sep).slice(0, -1).join("/");
    return [dir === "" ? "/" : `/${dir}/`, readFileSync(file, "utf8")];
  }),
);

const broken = findBrokenLinks(pages);
for (const { from, href } of broken) console.log(`${from} -> ${href}`);
console.log(`${String(pages.size)} routes, ${String(broken.length)} broken`);

if (broken.length > 0) process.exitCode = 1;
