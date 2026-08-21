// Fails the build when the site links to a page it never emitted. Run after
// build: `pnpm links:check [dir]`, defaulting to `dist`.
import { readdirSync, readFileSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";

import { findBrokenLinks, findBrokenSiteLinks } from "./links.mjs";

// Usage: check-links.mjs [dist-dir] [markdown-file ...]
// Each markdown file is checked for absolute links into the deployed site, so
// a route rename cannot leave a dead link that npm renders. Naming the files
// rather than assuming them keeps the checker usable on any directory.
const [root = "dist", ...external] = process.argv.slice(2);

// Kept in step with `site` in astro.config.mjs.
const SITE = "https://distillate.akxp.net";

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

const routes = new Set(pages.keys());
let outside = 0;
for (const file of external) {
  for (const url of findBrokenSiteLinks(
    readFileSync(file, "utf8"),
    SITE,
    routes,
  )) {
    console.log(`${basename(file)} -> ${url}`);
    outside += 1;
  }
}

const total = broken.length + outside;
console.log(`${String(pages.size)} routes, ${String(total)} broken`);

if (total > 0) process.exitCode = 1;
