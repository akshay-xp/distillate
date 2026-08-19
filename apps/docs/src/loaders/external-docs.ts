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
