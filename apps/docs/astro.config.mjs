import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

// The only definition of the deployed origin. Keep it a root URL so `base`
// never has to be set and the absolute asset paths Astro emits stay correct.
export const site = "https://distillate.akxp.net";

export default defineConfig({
  site,
  integrations: [
    starlight({
      title: "distillate",
      // Starlight's own /404 route collides with the /404 the catch-all docs
      // route emits for src/content/docs/404.md, and Astro 7 warns on the
      // conflict. Dropping Starlight's route leaves the authored page.
      disable404Route: true,
      sidebar: [
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
      ],
    }),
  ],
});
