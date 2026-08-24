// The only definition of the deployed origin. Keep it a root URL so `base`
// never has to be set and the absolute asset paths Astro emits stay correct.
//
// It lives here rather than in astro.config.mjs so the link checker can read it
// without executing `defineConfig` and `starlight()`, which a plain Node script
// has no reason to run.
export const site = "https://distillate.akxp.net";
