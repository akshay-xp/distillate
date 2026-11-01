// Installs the two tarballs as a user would, with nothing but each other to
// satisfy them. A published range that rejects the packed distillate makes the
// offline install fail, and on 0.x a literal caret range does exactly that one
// minor later. The workspace can't catch this: there, the link always resolves.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packages = fileURLToPath(new URL("../..", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "distillate-packed-"));

const pack = (name) =>
  execFileSync("pnpm", ["pack", "--pack-destination", dir], {
    cwd: join(packages, name),
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .at(-1);

const compare = (load) => `
const names = Object.keys(original).sort();
if (Object.keys(wrapper).sort().join() !== names.join()) throw new Error("${load}: exports differ");
for (const name of names) {
  if (wrapper[name] !== original[name]) throw new Error("${load}: " + name + " is a copy");
}
`;

try {
  const tarballs = [pack("distillate"), pack("hyperloglog")];
  writeFileSync(join(dir, "package.json"), '{ "private": true }');
  execFileSync(
    "npm",
    ["install", "--offline", "--no-audit", "--no-fund", ...tarballs],
    { cwd: dir, stdio: "inherit" },
  );

  const nested = "node_modules/@distillate/hyperloglog/node_modules/distillate";
  if (existsSync(join(dir, nested))) {
    throw new Error("the wrapper installed a second copy of distillate");
  }

  writeFileSync(
    join(dir, "esm.mjs"),
    `import * as wrapper from "@distillate/hyperloglog";
import * as original from "distillate/hll";
${compare("esm")}`,
  );
  writeFileSync(
    join(dir, "cjs.cjs"),
    `const wrapper = require("@distillate/hyperloglog");
const original = require("distillate/hll");
${compare("cjs")}`,
  );
  for (const file of ["esm.mjs", "cjs.cjs"]) {
    execFileSync("node", [file], { cwd: dir, stdio: "inherit" });
  }
  console.log("packed smoke ok: one distillate, same classes in ESM and CJS");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
