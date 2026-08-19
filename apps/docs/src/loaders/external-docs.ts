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

function rewriteLine(line: string, opts: RewriteOptions): string {
  return line.replace(RELATIVE_MD_LINK, (whole, target: string) => {
    const route = opts.siteRoutes[target];
    if (route) return `](${route})`;
    if (opts.githubDocs.has(target)) return `](${opts.githubBase}${target})`;
    throw new Error(
      `${opts.file}: link to ${target} is in neither siteRoutes nor githubDocs`,
    );
  });
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
