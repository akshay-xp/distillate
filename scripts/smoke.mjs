// Runtime smoke test: the built ESM entry must import and expose VERSION.
// Run under each target runtime in CI (node / bun / deno).
import { VERSION } from "../dist/index.js";

if (typeof VERSION !== "string") {
  console.error(
    `smoke: expected VERSION to be a string, got ${typeof VERSION}`,
  );
  process.exit(1);
}

console.log(`smoke ok: VERSION = ${VERSION}`);
