import tailwindcss from "@tailwindcss/vite";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightTypeDoc, { typeDocSidebarGroup } from "starlight-typedoc";

import { site } from "./site.mjs";

export default defineConfig({
  site,
  vite: {
    plugins: [tailwindcss()],
  },
  integrations: [
    starlight({
      title: "distillate",
      customCss: ["./src/styles/global.css"],
      components: {
        SiteTitle: "./src/components/SiteTitle.astro",
      },
      // Same flavor pair as the chrome (see global.css): Mocha dark, Latte
      // light, both bundled in Shiki already, so code blocks never clash
      // with the rest of the page.
      expressiveCode: {
        themes: ["catppuccin-mocha", "catppuccin-latte"],
      },
      // Geist and Geist Mono, the design system's two faces (see the
      // direction contract atop global.css). Preconnect before the
      // stylesheet request so the font fetch does not wait on DNS/TLS.
      head: [
        {
          tag: "link",
          attrs: { rel: "preconnect", href: "https://fonts.googleapis.com" },
        },
        {
          tag: "link",
          attrs: {
            rel: "preconnect",
            href: "https://fonts.gstatic.com",
            crossorigin: "anonymous",
          },
        },
        {
          tag: "link",
          attrs: {
            rel: "stylesheet",
            href: "https://fonts.googleapis.com/css2?family=Geist:wght@100..900&family=Geist+Mono:wght@100..900&family=BBH+Bartle&display=swap",
          },
        },
      ],
      // Starlight's own /404 route collides with the /404 the catch-all docs
      // route emits for src/content/docs/404.md, and Astro 7 warns on the
      // conflict. Dropping Starlight's route leaves the authored page.
      disable404Route: true,
      // The teaching path: start here, then guides, then reference. Supporting
      // material follows, and the generated API tree is last.
      sidebar: [
        {
          label: "Start here",
          items: [
            {
              label: "What is an AMQ filter?",
              link: "/start/what-is-an-amq-filter/",
            },
            // Before Install, deliberately: the guarantee is easier to believe
            // once you have watched it than after reading about it.
            { label: "Playground", link: "/start/playground/" },
            { label: "Install", link: "/start/install/" },
          ],
        },
        {
          label: "Guides",
          items: [
            {
              label: "Choosing a structure",
              link: "/guides/choosing-a-structure/",
            },
            { label: "Classic Bloom", link: "/guides/bloom/" },
            { label: "Blocked Bloom", link: "/guides/blocked/" },
            { label: "Binary Fuse", link: "/guides/fuse/" },
            { label: "HyperLogLog", link: "/guides/hll/" },
            { label: "Sizing and tuning FPR", link: "/guides/sizing/" },
            {
              label: "Sizing calculator",
              link: "/guides/sizing/calculator/",
            },
            { label: "Cross-runtime usage", link: "/guides/cross-runtime/" },
            {
              label: "Migrating from bloom-filters",
              link: "/guides/migrating-from-bloom-filters/",
            },
          ],
        },
        {
          label: "Reference",
          items: [
            {
              label: "Serialization format",
              link: "/reference/serialization/",
            },
            { label: "Versioning and support", link: "/reference/versioning/" },
            { label: "Errors", link: "/reference/errors/" },
          ],
        },
        {
          label: "Benchmarks",
          items: [
            { label: "Results", link: "/bench/results/" },
            { label: "Methodology", link: "/bench/methodology/" },
          ],
        },
        {
          label: "Internals",
          items: [{ label: "Hashing", link: "/internals/hashing/" }],
        },
        typeDocSidebarGroup,
      ],
      plugins: [
        starlightTypeDoc({
          entryPoints: [
            "../../packages/distillate/src/index.ts",
            "../../packages/distillate/src/bloom/index.ts",
            "../../packages/distillate/src/blocked/index.ts",
            "../../packages/distillate/src/fuse/index.ts",
            "../../packages/distillate/src/hll/index.ts",
          ],
          tsconfig: "../../packages/distillate/tsconfig.json",
          sidebar: { label: "API reference" },
          // Generation only. starlight-typedoc never calls app.validate(), and
          // typedoc enforces treatWarningsAsErrors only in its CLI, so passing
          // either here does nothing. The undocumented-export gate is
          // `pnpm docs:check`, configured in packages/distillate/typedoc.json.
          typeDoc: {
            // The plugin deletes every generated `<module>/README.md` while
            // its own index still links to them, so the default name leaves
            // four dead routes. Anything else keeps those pages. It must never
            // match an entry point name: `index` would collide with
            // `src/index.ts` and silently overwrite the module list, which a
            // link check cannot catch because the result is still valid HTML.
            entryFileName: "overview",
            excludeInternal: true,
            gitRevision: "main",
          },
        }),
      ],
    }),
  ],
});
