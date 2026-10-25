import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const pkg = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../../packages/distillate/package.json", import.meta.url),
    ),
    "utf8",
  ),
) as {
  description: string;
  keywords: string[];
  exports: Record<string, unknown>;
};

// A nested subpath such as ./ddsketch/protobuf is a codec for the structure
// above it, not a structure of its own.
export const structureSubpaths = Object.keys(pkg.exports).filter(
  (key) =>
    ![".", "./frame", "./package.json"].includes(key) &&
    key.split("/").length === 2,
);

/** Each structure's name as people search for it: its npm keyword. */
export const SEARCH_NAME: Record<string, string> = {
  "./bloom": "bloom-filter",
  "./blocked": "blocked-bloom-filter",
  "./scalable": "scalable-bloom-filter",
  "./fuse": "binary-fuse-filter",
  "./cuckoo": "cuckoo-filter",
  "./hll": "hyperloglog",
  "./theta": "theta-sketch",
  "./countmin": "count-min-sketch",
  "./topk": "top-k",
  "./ddsketch": "ddsketch",
  "./kll": "kll-sketch",
  "./minhash": "minhash",
  "./riblt": "riblt",
};
