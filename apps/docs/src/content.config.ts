import { docsSchema } from "@astrojs/starlight/schema";
import { defineCollection } from "astro:content";

import { externalDocsLoader } from "./loaders/external-docs.js";

export const collections = {
  docs: defineCollection({
    loader: externalDocsLoader([
      { file: "apps/bench/RESULTS.md", id: "bench/results" },
      { file: "apps/bench/METHODOLOGY.md", id: "bench/methodology" },
      {
        file: "packages/distillate/docs/hashing.md",
        id: "internals/hashing",
        // Contributor docs the site does not render yet.
        githubDocs: ["serialization.md", "architecture.md"],
      },
    ]),
    schema: docsSchema(),
  }),
};
