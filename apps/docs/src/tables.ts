const HEADING = /^#{2,6}\s+/;

function isHeading(line: string, heading: string): boolean {
  return HEADING.test(line) && line.replace(HEADING, "").trim() === heading;
}

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

/**
 * The data rows of the first pipe table under `heading`.
 *
 * Addressed by heading rather than by position so that inserting a paragraph
 * cannot silently repoint a check at a different table.
 *
 * @param markdown - Contents of the page.
 * @param heading - Heading text, without its leading `#` characters.
 * @returns One array of trimmed cells per row, excluding the header and its
 * separator.
 * @throws If the heading is absent, or carries no table before the next one.
 */
export function parseTable(markdown: string, heading: string): string[][] {
  const lines = markdown.split("\n");
  const at = lines.findIndex((line) => isHeading(line, heading));
  if (at === -1) throw new Error(`no heading "${heading}"`);

  const rows: string[][] = [];
  for (const line of lines.slice(at + 1)) {
    const isRow = line.trimStart().startsWith("|");
    if (!isRow) {
      // Blank lines before the table are fine; anything after it ends it.
      if (rows.length > 0 || HEADING.test(line)) break;
      continue;
    }
    const row = cells(line);
    if (row.every((cell) => /^-+$/.test(cell))) continue;
    rows.push(row);
  }

  if (rows.length === 0) throw new Error(`no table under "${heading}"`);
  return rows.slice(1);
}
