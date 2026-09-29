// The published entry points, derived from package.json exports. The build,
// the API reports, the undocumented-export gate and the published reference all
// read this rather than keeping their own lists, which drifted once: Count-Min
// was published but never gated. Adding a subpath means adding its export; its
// size budget and API report are the only other files, and size:check and
// api:check each fail naming the one that is missing.
import { readFileSync } from "node:fs";

/**
 * One entry per code export, in exports order.
 *
 * @param {Record<string, unknown>} exports
 * @returns {{ subpath: string; name: string; src: string; dts: string }[]}
 */
export function entriesOf(exports) {
  const entries = [];
  for (const [subpath, value] of Object.entries(exports)) {
    const target = typeof value === "object" && value !== null ? value : {};
    const built = /** @type {{ import?: unknown }} */ (target).import;
    if (typeof built !== "string" || !built.endsWith(".js")) continue;
    const dir = subpath === "." ? "" : `${subpath.slice(2)}/`;
    entries.push({
      subpath,
      name: subpath === "." ? "distillate" : subpath.slice(2),
      src: `src/${dir}index.ts`,
      dts: `dist/${dir}index.d.ts`,
    });
  }
  return entries;
}

/** The entries of this package's own exports. Paths are package-relative. */
export function publishedEntries() {
  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  return entriesOf(pkg.exports);
}
