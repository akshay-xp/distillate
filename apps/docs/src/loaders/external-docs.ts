import { readFile } from "node:fs/promises";
import { basename, dirname } from "node:path";

import { docsLoader } from "@astrojs/starlight/loaders";
import type { Loader, LoaderContext } from "astro/loaders";

// The first ATX h1 plus the blank line that separates it from the body.
const H1 = /^#[ \t]+(.+?)[ \t]*\r?\n(?:[ \t]*\r?\n)?/;

export function parseTitle(
  source: string,
  filename: string,
): { title: string; body: string } {
  const match = H1.exec(source);
  if (!match?.[1]) throw new Error(`${filename}: no h1 to use as the title`);
  return { title: match[1], body: source.slice(match[0].length) };
}

export interface RewriteOptions {
  /** Source file the body came from, for error messages. */
  file: string;
  /** Link target to the site route that renders it. */
  siteRoutes: Record<string, string>;
  /** Link targets that stay on GitHub. */
  githubDocs: Set<string>;
  githubBase: string;
}

// Markdown link to a sibling .md file, in both the ./NAME.md and NAME.md forms.
const RELATIVE_MD_LINK = /\]\((?:\.\/)?([\w.-]+\.md)\)/g;

const FENCE = /^\s*(?:```|~~~)/;

function resolveTarget(target: string, opts: RewriteOptions): string {
  const route = opts.siteRoutes[target];
  if (route) return route;
  if (opts.githubDocs.has(target)) return `${opts.githubBase}${target}`;
  throw new Error(
    `${opts.file}: link to ${target} is in neither siteRoutes nor githubDocs`,
  );
}

function rewriteLine(line: string, opts: RewriteOptions): string {
  return line.replace(
    RELATIVE_MD_LINK,
    (_match, target: string) => `](${resolveTarget(target, opts)})`,
  );
}

export function rewriteLinks(body: string, opts: RewriteOptions): string {
  let fenced = false;
  return body
    .split("\n")
    .map((line) => {
      if (FENCE.test(line)) {
        fenced = !fenced;
        return line;
      }
      return fenced ? line : rewriteLine(line, opts);
    })
    .join("\n");
}

const REPO_BLOB = "https://github.com/akshay-xp/distillate/blob/main/";

export interface ExternalSource {
  /** Path to the file, relative to the repository root. */
  file: string;
  /** Collection entry id, which is also the page route. */
  id: string;
  /** Sibling `.md` files this one links to that are not rendered here. */
  githubDocs?: string[];
}

async function loadSource(
  ctx: LoaderContext,
  source: ExternalSource,
  siteRoutes: Record<string, string>,
  repoRoot: URL,
): Promise<void> {
  const fileURL = new URL(source.file, repoRoot);
  const { title, body } = parseTitle(
    await readFile(fileURL, "utf8"),
    source.file,
  );
  const markdown = rewriteLinks(body, {
    file: source.file,
    siteRoutes,
    githubDocs: new Set(source.githubDocs ?? []),
    githubBase: `${REPO_BLOB}${dirname(source.file)}/`,
  });
  ctx.store.set({
    id: source.id,
    data: await ctx.parseData({ id: source.id, data: { title } }),
    body: markdown,
    filePath: source.file,
    digest: ctx.generateDigest(markdown),
    rendered: await ctx.renderMarkdown(markdown, { fileURL }),
  });
}

/**
 * Link targets for every page the site owns: one derived from each in-place
 * source, plus `authored` for pages that live in `src/content/docs` and so
 * have no source file to derive from. An explicit entry wins, which is what
 * lets a doc move into the site without its in-place linkers going stale.
 */
export function siteRoutesFor(
  sources: ExternalSource[],
  authored: Record<string, string> = {},
): Record<string, string> {
  return {
    ...Object.fromEntries(sources.map((s) => [basename(s.file), `/${s.id}/`])),
    ...authored,
  };
}

/**
 * Renders files that live outside the docs site as pages, leaving the files
 * where they are. Layers over Starlight's own loader so authored pages in
 * `src/content/docs` keep working.
 *
 * @param sources - Files to render in place.
 * @param authored - Extra `filename.md` to route mappings for site-owned pages
 * that are not in-place sources.
 */
export function externalDocsLoader(
  sources: ExternalSource[],
  authored: Record<string, string> = {},
): Loader {
  const { load: loadDocs } = docsLoader();
  const siteRoutes = siteRoutesFor(sources, authored);
  return {
    name: "external-docs-loader",
    load: async (ctx) => {
      await loadDocs(ctx);
      const repoRoot = new URL("../../", ctx.config.root);
      for (const source of sources) {
        await loadSource(ctx, source, siteRoutes, repoRoot);
      }
    },
  };
}
