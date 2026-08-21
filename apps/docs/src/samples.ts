import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

/** One fenced `ts` block lifted from a documentation page. */
export interface Sample {
  /** Page the block came from, relative to the directory that was scanned. */
  file: string;
  /** Position of the block within that page, counting from 1. */
  index: number;
  /** The block's contents. */
  code: string;
}

// A ```ts fence and its body. Only `ts`, so `sh` and `js` blocks are ignored.
const TS_FENCE = /^```ts[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gm;

// starlight-typedoc regenerates this tree on every build. Its ts fences are
// extracted signatures, not samples, so they neither compile alone nor say
// anything the source has not already been checked for.
const GENERATED = new Set(["api"]);

function markdownFilesIn(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (GENERATED.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...markdownFilesIn(full));
    else if (entry.name.endsWith(".md")) found.push(full);
  }
  return found.sort();
}

/**
 * Every fenced `ts` block in `target`, in a stable order. `target` is either a
 * directory to walk or a single markdown file, which is how a lone README is
 * checked without scanning the package around it.
 */
export function extractSamples(target: string): Sample[] {
  const isFile = statSync(target).isFile();
  const files = isFile ? [target] : markdownFilesIn(target);
  // A directory names its pages by their path within it; a lone file has no
  // such path, and `relative` would call it the empty string.
  const nameOf = isFile
    ? basename
    : (file: string) => relative(target, file).split(sep).join("/");

  const samples: Sample[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    let index = 0;
    for (const match of source.matchAll(TS_FENCE)) {
      index++;
      samples.push({
        file: nameOf(file),
        index,
        code: match[1],
      });
    }
  }
  return samples;
}

// Matches the published package's own tsconfig, so a sample is held to the
// same rules as the code it documents. `noUnusedLocals` stays off: a sample
// names a value to show its type, and is not obliged to use it.
const OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
  noUncheckedIndexedAccess: true,
  skipLibCheck: true,
  noEmit: true,
  types: [],
};

// Samples are written next to the docs app so Node resolution finds the
// workspace build through apps/docs/node_modules/distillate. A temp dir
// elsewhere would resolve nothing.
const APP_DIR = fileURLToPath(new URL("..", import.meta.url));

function sampleFileName(sample: Sample): string {
  const stem = sample.file.replace(/\.md$/, "").replace(/[^\w-]/g, "-");
  return `${stem}-${String(sample.index)}.ts`;
}

/**
 * Typechecks each sample as its own module against the workspace build, so a
 * sample that uses an API the shipped types do not have fails here rather
 * than in a reader's editor. Typecheck only; nothing is executed.
 *
 * @returns One formatted message per diagnostic, empty when every sample is
 * clean.
 */
export function typecheckSamples(samples: Sample[]): string[] {
  if (samples.length === 0) return [];

  const dir = mkdtempSync(join(APP_DIR, ".samples-"));
  try {
    const written = samples.map((sample) => {
      const path = join(dir, sampleFileName(sample));
      writeFileSync(path, sample.code);
      return { sample, path };
    });

    const program = ts.createProgram(
      written.map((w) => w.path),
      OPTIONS,
    );
    const origin = new Map(written.map((w) => [w.path, w.sample]));

    return ts
      .getPreEmitDiagnostics(program)
      .map((diagnostic) => format(diagnostic, origin));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function format(
  diagnostic: ts.Diagnostic,
  origin: Map<string, Sample>,
): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
  const { file, start } = diagnostic;
  const sample = file && origin.get(file.fileName);
  if (!file || !sample || start === undefined) {
    return `TS${String(diagnostic.code)}: ${message}`;
  }
  const { line, character } = file.getLineAndCharacterOfPosition(start);
  const where = `${sample.file} block ${String(sample.index)}`;
  const at = `${String(line + 1)}:${String(character + 1)}`;
  return `${where} (${at}): TS${String(diagnostic.code)}: ${message}`;
}
