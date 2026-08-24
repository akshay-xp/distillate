// Fails the build when a link points at a page the site never emitted. Run it
// after a build: `check-links.mjs [dist-dir] [sweep-root]`.
//
// Links inside the built site are checked against the routes it emitted. Every
// markdown under the sweep root is checked too, so a route rename cannot leave
// a dead link that npm or GitHub renders. Sweeping rather than listing means a
// doc is checked because it exists: the named-file version missed the root
// README and CONTRIBUTING.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

import { findBrokenLinks, findBrokenSiteLinks } from "./links.mjs";

const [root = "dist", sweep] = process.argv.slice(2);

// Kept in step with `site` in astro.config.mjs.
const SITE = "https://distillate.akxp.net";

/**
 * Path of `file` within `from`, with `/` separators whatever the platform.
 *
 * @param {string} from @param {string} file @returns {string}
 */
function within(from, file) {
  return relative(from, file).split(sep).join("/");
}

/** @param {string} dir @returns {string[]} */
function htmlFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return htmlFiles(path);
    return entry.name.endsWith(".html") ? [path] : [];
  });
}

// Vendored and built trees are not ours to fix, hidden ones are tooling, and a
// changelog records what was true when it was written, so a URL that has since
// moved is history rather than a broken link.
/** @param {string} dir @returns {string[]} */
function markdownFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".")) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const skip = entry.name === "node_modules" || entry.name === "dist";
      return skip ? [] : markdownFiles(path);
    }
    const keep = entry.name.endsWith(".md") && entry.name !== "CHANGELOG.md";
    return keep ? [path] : [];
  });
}

/** Astro emits `<route>/index.html`, so the directory is the route. */
const pages = new Map(
  htmlFiles(root).map((file) => {
    const dir = within(root, dirname(file));
    return [dir === "" ? "/" : `/${dir}/`, readFileSync(file, "utf8")];
  }),
);

const broken = findBrokenLinks(pages);
for (const { from, href } of broken) console.log(`${from} -> ${href}`);

const routes = new Set(pages.keys());
let outside = 0;
for (const file of sweep === undefined ? [] : markdownFiles(sweep)) {
  // Named by path within the sweep, not by basename: a sweep turns up more
  // than one README.md, and "README.md -> ..." would not say which.
  const name = within(sweep, file);
  for (const url of findBrokenSiteLinks(
    readFileSync(file, "utf8"),
    SITE,
    routes,
  )) {
    console.log(`${name} -> ${url}`);
    outside += 1;
  }
}

const total = broken.length + outside;
console.log(`${String(pages.size)} routes, ${String(total)} broken`);

if (total > 0) process.exitCode = 1;
