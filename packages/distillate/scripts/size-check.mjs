// Bundle-size gate: every published subpath's transitive built size (raw and
// gzipped) must stay under its committed budget in size-budget.json. Run after
// build. `pnpm size:check` (CI gates the build with it).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const pkgDir = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (rel) => readFileSync(join(pkgDir, rel));

const pkg = JSON.parse(read("package.json").toString());
const budget = JSON.parse(read("size-budget.json").toString());

// The static-import closure of an entry: the entry plus every relative module
// it pulls in (transitively), which is the real cost of importing the subpath.
const closure = (entryRel) => {
  const seen = new Set();
  const stack = [entryRel];
  while (stack.length) {
    const rel = stack.pop();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const src = read(rel).toString();
    for (const m of src.matchAll(/from\s*"(\.[^"]+)"/g)) {
      stack.push(join(dirname(rel), m[1]));
    }
  }
  return [...seen].sort();
};

const failures = [];
const rows = [];

for (const [subpath, value] of Object.entries(pkg.exports)) {
  const entry = typeof value === "object" ? value.import : null;
  if (typeof entry !== "string" || !entry.endsWith(".js")) continue;
  const limit = budget[subpath];
  if (!limit) {
    failures.push(`${subpath}: no budget in size-budget.json`);
    continue;
  }
  const bytes = Buffer.concat(closure(entry.replace(/^\.\//, "")).map(read));
  const raw = bytes.length;
  const gzip = gzipSync(bytes).length;
  rows.push({ subpath, raw, gzip, limit });
  if (raw > limit.raw) {
    failures.push(`${subpath}: raw ${raw} > budget ${limit.raw}`);
  }
  if (gzip > limit.gzip) {
    failures.push(`${subpath}: gzip ${gzip} > budget ${limit.gzip}`);
  }
}

for (const { subpath, raw, gzip, limit } of rows) {
  console.log(
    `${subpath.padEnd(10)} raw ${String(raw).padStart(6)}/${limit.raw}  gzip ${String(gzip).padStart(5)}/${limit.gzip}`,
  );
}

if (failures.length) {
  console.error(`\nsize:check failed:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log("\nsize:check ok: all subpaths within budget");
