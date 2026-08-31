import ts from "typescript";

/** A result comment a sample makes about one of its own expressions. */
export interface Claim {
  /** Source text of the expression the comment is about. */
  expr: string;
  /** The claimed value, as source text, with any `~` marker stripped. */
  literal: string;
}

// A claim comment is a literal and nothing else. `// 9` is a claim; `// 9.59
// bits per key` and `// 3, not 4` are prose that happens to open with a number,
// and guessing at those would turn every reworded comment into a failure.
const LITERAL =
  /^~?\s*(-?\d[\d_]*(\.\d+)?([eE][-+]?\d+)?|true|false|"[^"]*"|\{.*\})$/;

// The value a statement's trailing comment is about. A declaration counts
// because the numbers most likely to drift are bound to a name before they are
// used: the stale `v: 3` in the JSON envelope was one of these, not a bare
// expression. Only a lone declarator qualifies, since `const a = 1, b = 2`
// gives the comment two candidates and no way to choose.
function claimedExpr(node: ts.Node, source: ts.SourceFile): string | null {
  if (ts.isExpressionStatement(node)) return node.expression.getText(source);
  if (ts.isVariableStatement(node)) {
    const declarations = node.declarationList.declarations;
    if (declarations.length !== 1) return null;
    const initializer = declarations[0].initializer;
    if (initializer) return initializer.getText(source);
  }
  return null;
}

/**
 * Every claim a sample makes about itself, in source order.
 *
 * @param code - The sample's contents.
 * @returns One entry per statement whose trailing comment is a bare literal.
 */
export function claimsIn(code: string): Claim[] {
  const source = ts.createSourceFile(
    "sample.ts",
    code,
    ts.ScriptTarget.ES2022,
    true,
  );

  const claims: Claim[] = [];
  const visit = (node: ts.Node): void => {
    const expr = claimedExpr(node, source);
    if (expr !== null) {
      for (const range of ts.getTrailingCommentRanges(code, node.end) ?? []) {
        if (range.kind !== ts.SyntaxKind.SingleLineCommentTrivia) continue;
        const text = code.slice(range.pos + 2, range.end).trim();
        if (LITERAL.test(text)) {
          claims.push({ expr, literal: text.replace(/^~\s*/, "") });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return claims;
}
