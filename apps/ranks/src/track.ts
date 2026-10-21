import {
  QUERIES,
  REPO,
  type Row,
  TRACKED,
  appendRows,
  downloadsRow,
  recorded,
  retryDelay,
  githubRow,
  npmRows,
} from "./ranks.js";

// GitHub allows 30 authenticated searches a minute. npm publishes no limit
// but answers 429 to a burst, without a Retry-After, so it is paced too.
const GITHUB_SPACING_MS = 2_100;
const NPM_SPACING_MS = 1_500;
const DEPTH = 250;

const path = process.argv[2];
if (!path) throw new Error("usage: track <csv path>");
const date = new Date().toISOString().slice(0, 10);
const token = process.env.GITHUB_TOKEN;

// One run per date: a manual dispatch on a day the schedule also runs would
// otherwise double that day's rows. A failed run writes nothing, so a rerun
// after one still records.
if (recorded(path, date)) {
  console.log(`${date} is already recorded in ${path}`);
  process.exit(0);
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function json(
  url: string,
  headers?: Record<string, string>,
): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { headers });
    if (response.ok) return response.json();
    const wait = retryDelay(
      response.status,
      response.headers.get("retry-after"),
      attempt,
    );
    if (wait === undefined) {
      throw new Error(`${String(response.status)} from ${url}`);
    }
    await sleep(wait);
  }
}

async function githubNames(query: string): Promise<string[]> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const names: string[] = [];
  for (let page = 1; names.length < DEPTH; page++) {
    await sleep(GITHUB_SPACING_MS);
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=100&page=${String(page)}`;
    const { items } = (await json(url, headers)) as {
      items: { full_name: string }[];
    };
    names.push(...items.map((item) => item.full_name));
    if (items.length < 100 || names.includes(REPO)) break;
  }
  return names.slice(0, DEPTH);
}

const rows: Row[] = [];
for (const query of QUERIES) {
  await sleep(NPM_SPACING_MS);
  const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=${String(DEPTH)}`;
  rows.push(...npmRows(date, query, await json(url)));
}
for (const query of QUERIES) {
  rows.push(githubRow(date, query, await githubNames(query)));
}
for (const name of TRACKED) {
  const response = await fetch(
    `https://api.npmjs.org/downloads/point/last-week/${name}`,
  );
  // 404 is npm's answer for a package not yet published; anything else fails.
  if (!response.ok && response.status !== 404) {
    throw new Error(`${String(response.status)} from downloads for ${name}`);
  }
  rows.push(downloadsRow(date, name, response.status, await response.json()));
}
// Written only once every source has answered, so a failed run adds nothing.
appendRows(path, rows);
console.log(`${String(rows.length)} rows for ${date} appended to ${path}`);
