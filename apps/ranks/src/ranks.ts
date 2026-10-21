import { appendFileSync, existsSync, readFileSync } from "node:fs";

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

/** The repo's row for GitHub search results gathered so far, by full name. */
export function githubRow(
  date: string,
  query: string,
  fullNames: readonly string[],
): Row {
  const at = fullNames.indexOf(REPO);
  return {
    date,
    source: "github",
    query,
    name: REPO,
    rank: at === -1 ? "" : String(at + 1),
    score: "",
    downloads: "",
  };
}

/**
 * A package's weekly downloads from npm's downloads API; empty on a 404, which
 * is npm's answer for a package that has not been published yet.
 */
export function downloadsRow(
  date: string,
  name: string,
  status: number,
  body: unknown,
): Row {
  return {
    date,
    source: "downloads",
    query: "",
    name,
    rank: "",
    score: "",
    downloads:
      status === 200 ? String((body as { downloads: number }).downloads) : "",
  };
}

export const CSV_HEADER = "date,source,query,name,rank,score,downloads";

/**
 * Appends rows to the CSV at path, writing the header first when the file is
 * new. Values go in unquoted: queries and names are fixed and hold no comma.
 */
export function appendRows(path: string, rows: readonly Row[]): void {
  const lines = rows.map((r) =>
    [r.date, r.source, r.query, r.name, r.rank, r.score, r.downloads].join(","),
  );
  if (!existsSync(path)) lines.unshift(CSV_HEADER);
  appendFileSync(path, lines.map((line) => `${line}\n`).join(""));
}

const RETRY_MS = [30_000, 60_000, 120_000];

/**
 * How long to wait before retrying a failed request, or undefined to give up.
 * npm answers a burst with 429 and no Retry-After; GitHub's secondary rate
 * limit answers 403 with one. A 403 without it is a real refusal.
 */
export function retryDelay(
  status: number,
  retryAfter: string | null,
  attempt: number,
): number | undefined {
  const limited = status === 429 || (status === 403 && retryAfter !== null);
  const backoff = RETRY_MS[attempt];
  if (!limited || backoff === undefined) return undefined;
  const seconds = Number(retryAfter);
  return seconds > 0 ? seconds * 1000 : backoff;
}

/** Whether the CSV at path already holds rows for date. */
export function recorded(path: string, date: string): boolean {
  return (
    existsSync(path) &&
    readFileSync(path, "utf8")
      .split("\n")
      .some((line) => line.startsWith(`${date},`))
  );
}
