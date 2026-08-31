import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import ts from "typescript";

import { APP_DIR, type Sample } from "./samples.js";

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

interface Located extends Claim {
  /** Bounds of the statement carrying the claim. */
  start: number;
  end: number;
  /** Whether the statement has to survive instrumentation. */
  keep: boolean;
  /** Expression the collector evaluates, read back where a name exists. */
  read: string;
}

// What a statement's trailing comment is about. A declaration counts because
// the numbers most likely to drift are bound to a name before they are used:
// the stale `v: 3` in the JSON envelope was one of these, not a bare
// expression. Only a lone declarator qualifies, since `const a = 1, b = 2`
// gives the comment two candidates and no way to choose.
function subject(
  node: ts.Node,
  source: ts.SourceFile,
): { expr: string; read: string; keep: boolean } | null {
  if (ts.isExpressionStatement(node)) {
    const expr = node.expression.getText(source);
    return { expr, read: expr, keep: false };
  }
  if (ts.isVariableStatement(node)) {
    const declarations = node.declarationList.declarations;
    if (declarations.length !== 1) return null;
    const only = declarations[0];
    if (!only.initializer) return null;
    const expr = only.initializer.getText(source);
    // Reading the binding back beats recomputing the initialiser, which would
    // run any side effect a second time. Destructuring has no single name to
    // read, so there the initialiser is evaluated again.
    const read = ts.isIdentifier(only.name) ? only.name.getText(source) : expr;
    return { expr, read, keep: true };
  }
  return null;
}

function locate(code: string): Located[] {
  const source = ts.createSourceFile(
    "sample.ts",
    code,
    ts.ScriptTarget.ES2022,
    true,
  );

  const found: Located[] = [];
  const visit = (node: ts.Node): void => {
    const about = subject(node, source);
    if (about) {
      for (const range of ts.getTrailingCommentRanges(code, node.end) ?? []) {
        if (range.kind !== ts.SyntaxKind.SingleLineCommentTrivia) continue;
        const text = code.slice(range.pos + 2, range.end).trim();
        if (!LITERAL.test(text)) continue;
        found.push({
          ...about,
          literal: text.replace(/^~\s*/, ""),
          start: node.getStart(source),
          end: node.end,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return found;
}

/**
 * Every claim a sample makes about itself, in source order.
 *
 * @param code - The sample's contents.
 * @returns One entry per statement whose trailing comment is a bare literal.
 */
export function claimsIn(code: string): Claim[] {
  return locate(code).map(({ expr, literal }) => ({ expr, literal }));
}

interface Recorded extends Claim {
  actual: unknown;
  claimed: unknown;
}

// The generated module and this one share a realm, so a global is the whole of
// the channel between them.
const SINK = "__distillateClaims";

function instrument(code: string, located: Located[]): string {
  let out = code;
  // Back to front, so an earlier splice cannot move a later one's offsets.
  for (const claim of [...located].sort((a, b) => b.start - a.start)) {
    const statement = claim.keep ? out.slice(claim.start, claim.end) : "";
    const record = [
      `expr: ${JSON.stringify(claim.expr)}`,
      `literal: ${JSON.stringify(claim.literal)}`,
      `actual: (${claim.read})`,
      `claimed: (${claim.literal})`,
    ].join(", ");
    out =
      out.slice(0, claim.start) +
      `${statement} globalThis.${SINK}.push({ ${record} });` +
      out.slice(claim.end);
  }
  return out;
}

// Compared at the precision the comment states, so `// 9.04` and `// 9.044`
// are both honoured for the same underlying value. An object claim names only
// the keys it cares about, and `"..."` stands for a value too long to quote.
function holds(actual: unknown, claimed: unknown): boolean {
  if (typeof claimed === "number" && typeof actual === "number") {
    const written = String(claimed);
    // Exponent form states no decimal places to round to, so it is held to
    // the value itself.
    if (written.includes("e")) return actual === claimed;
    const dot = written.indexOf(".");
    const decimals = dot === -1 ? 0 : written.length - dot - 1;
    return Number(actual.toFixed(decimals)) === claimed;
  }
  if (claimed !== null && typeof claimed === "object") {
    if (actual === null || typeof actual !== "object") return false;
    const seen = actual as Record<string, unknown>;
    return Object.entries(claimed).every(
      ([key, value]) => value === "..." || Object.is(seen[key], value),
    );
  }
  return Object.is(actual, claimed);
}

function describe(value: unknown): string {
  const text = value === undefined ? "undefined" : JSON.stringify(value);
  return text.length > 120 ? `${text.slice(0, 120)}...` : text;
}

function where(sample: Sample): string {
  return `${sample.file} block ${String(sample.index)}`;
}

/**
 * Runs each sample and checks the claims it makes about itself.
 *
 * `typecheckSamples` proves a sample compiles; this proves the numbers it
 * quotes are the ones the library produces. A sample that throws is reported
 * rather than left to fail the suite from inside a dynamic import.
 *
 * @param samples - Samples to execute, from `extractSamples`.
 * @returns One message per contradicted claim, empty when every claim holds.
 */
export async function runClaims(samples: Sample[]): Promise<string[]> {
  const dir = mkdtempSync(join(APP_DIR, ".claims-"));
  const sink = globalThis as unknown as Record<string, Recorded[]>;
  const failures: string[] = [];

  try {
    for (const sample of samples) {
      const located = locate(sample.code);
      if (located.length === 0) continue;

      const module = ts.transpileModule(instrument(sample.code, located), {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
        },
      }).outputText;

      const stem = `${sample.file.replace(/[^\w-]/g, "-")}-${String(sample.index)}`;
      const path = join(dir, `${stem}.mjs`);
      writeFileSync(path, module);

      const collected: Recorded[] = [];
      sink[SINK] = collected;
      try {
        await import(pathToFileURL(path).href);
      } catch (error) {
        failures.push(`${where(sample)}: threw ${String(error)}`);
        continue;
      }

      for (const record of collected) {
        if (holds(record.actual, record.claimed)) continue;
        failures.push(
          `${where(sample)}: ${record.expr} claims ${record.literal}, library gives ${describe(record.actual)}`,
        );
      }
    }
  } finally {
    sink[SINK] = [];
    rmSync(dir, { recursive: true, force: true });
  }
  return failures;
}
