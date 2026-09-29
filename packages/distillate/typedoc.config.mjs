import { publishedEntries } from "./scripts/entries.mjs";

/**
 * Validation only. starlight-typedoc generates the published reference but
 * never calls app.validate(), and typedoc enforces treatWarningsAsErrors only
 * in its CLI, so the undocumented-export gate has to be its own run.
 *
 * Entry points come from package.json exports, the same list the build and
 * the reference read, so no published subpath can escape the gate.
 *
 * @type {import("typedoc").TypeDocOptions}
 */
export default {
  $schema: "https://typedoc.org/schema.json",
  entryPoints: publishedEntries().map((e) => e.src),
  tsconfig: "./tsconfig.json",
  readme: "none",
  excludeInternal: true,
  treatWarningsAsErrors: true,
  validation: {
    notDocumented: true,
    notExported: false,
    invalidLink: true,
  },
};
