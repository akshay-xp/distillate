import pkg from "../package.json" with { type: "json" };

/** The installed `distillate` package version. */
export const VERSION: string = pkg.version;
