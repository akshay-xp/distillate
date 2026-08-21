// Finds links the built site makes to pages it never emitted. Pure: the caller
// supplies the pages, so this is testable without a build. `pnpm links:check`
// runs it over `dist`.

/** @typedef {{ from: string, href: string }} BrokenLink */

/**
 * @param {string} href
 * @returns {string} The href with any fragment and query cut off.
 */
function pathOf(href) {
  return href.split(/[#?]/, 1)[0];
}

// A path ending in an extension is a file the build copied, not a page it
// routed: hashed `_astro` bundles, favicons, `llms.txt`. The trailing slash is
// what separates `/llms.txt` from a page like `/reference/v0.7/`, so this has
// to run before that slash is normalised away.
/**
 * @param {string} path
 * @returns {boolean}
 */
function isAsset(path) {
  return !path.endsWith("/") && /\.\w+$/.test(path);
}

// `/b`, `/b/`, `/b#x` and `/b?q=1` all address the page emitted at `/b/`.
/**
 * @param {string} path
 * @returns {string}
 */
function routeOf(path) {
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
      // Anything not rooted at the site is someone else's to resolve:
      // external URLs, `mailto:`, bare fragments, relative paths.
      if (!href.startsWith("/")) continue;
      const path = pathOf(href);
      if (isAsset(path)) continue;
      if (!pages.has(routeOf(path))) broken.push({ from, href });
    }
  }
  return broken;
}

/**
 * Markdown outside the site, such as the package README, linking into it by
 * absolute URL. `findBrokenLinks` cannot see these: they are neither
 * root-relative nor written as `href`, so nothing checked them before.
 *
 * @param {string} markdown
 * @param {string} origin Site origin, without a trailing slash.
 * @param {ReadonlySet<string>} routes Routes the build emitted.
 * @returns {string[]} Every linked URL under `origin` with no such route.
 */
export function findBrokenSiteLinks(markdown, origin, routes) {
  /** @type {string[]} */
  const broken = [];
  for (const match of markdown.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) {
    const url = match[1];
    if (!url.startsWith(origin)) continue;
    const path = pathOf(url.slice(origin.length)) || "/";
    if (isAsset(path)) continue;
    if (!routes.has(routeOf(path))) broken.push(url);
  }
  return broken;
}
