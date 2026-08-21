// Finds links the built site makes to pages it never emitted. Pure: the caller
// supplies the pages, so this is testable without a build. `pnpm links:check`
// runs it over `dist`.

/** @typedef {{ from: string, href: string }} BrokenLink */

// `/b`, `/b/`, `/b#x` and `/b?q=1` all address the page emitted at `/b/`.
/**
 * @param {string} href
 * @returns {string}
 */
function routeOf(href) {
  const path = href.split(/[#?]/, 1)[0];
  return path.endsWith("/") ? path : `${path}/`;
}

/**
 * @param {ReadonlyMap<string, string>} pages Route to the HTML emitted at it.
 * @returns {BrokenLink[]} Every link whose target is not one of the routes.
 */
export function findBrokenLinks(pages) {
  /** @type {BrokenLink[]} */
  const broken = [];
  for (const [from, html] of pages) {
    for (const match of html.matchAll(/href="([^"]*)"/g)) {
      const href = match[1];
      if (!href.startsWith("/")) continue;
      if (!pages.has(routeOf(href))) broken.push({ from, href });
    }
  }
  return broken;
}
