/** Each structure's search name, plus the broader queries a newcomer types. */
export const QUERIES = [
  "bloom filter",
  "blocked bloom filter",
  "scalable bloom filter",
  "cuckoo filter",
  "binary fuse filter",
  "hyperloglog",
  "theta sketch",
  "count-min sketch",
  "top-k",
  "kll sketch",
  "ddsketch",
  "minhash",
  "riblt",
  "probabilistic data structures",
  "sketch",
  "quantile sketch",
] as const;

// A fixed list rather than a scope search: npm indexes a new package with a
// lag, and a package listed before it exists records its absence from day one.
export const TRACKED = ["distillate", "@distillate/hyperloglog"] as const;

export const REPO = "akshay-xp/distillate";

/** One CSV line; every field is a string, empty when there is nothing. */
export interface Row {
  date: string;
  source: "npm" | "github" | "downloads";
  query: string;
  name: string;
  rank: string;
  score: string;
  downloads: string;
}

interface NpmSearchBody {
  objects: {
    package: { name: string };
    score: { final: number };
    downloads: { weekly: number };
  }[];
}

/**
 * One row per tracked package for an npm search response, with an empty rank
 * when the package is not among the results.
 */
export function npmRows(date: string, query: string, body: unknown): Row[] {
  const { objects } = body as NpmSearchBody;
  return TRACKED.map((name) => {
    const at = objects.findIndex((o) => o.package.name === name);
    const hit = objects[at];
    return {
      date,
      source: "npm",
      query,
      name,
      rank: hit ? String(at + 1) : "",
      score: hit ? hit.score.final.toFixed(3) : "",
      downloads: hit ? String(hit.downloads.weekly) : "",
    };
  });
}
