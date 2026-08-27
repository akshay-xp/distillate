# Engineering

Packaging, testing, benchmarking, CI, release. Targets 2026 tooling.

## Repository layout

pnpm workspace (`pnpm-workspace.yaml`: `packages/*`, `apps/*`).

- `packages/distillate/`: the published library. All build/test/doc tooling (tsdown, vitest, typedoc, api-extractor) and its configs live here; source links and module docs (this file included) are under `packages/distillate/`.
- `apps/*`: private, non-published tooling (the cross-library bench, the docs site) that depends on the library via `workspace:*`, so it always tracks local source and cannot drift against a stale published version.
- Root is private: repo-wide tooling (eslint, prettier, husky, commitlint, changesets) and delegating scripts. Whole-tree tasks (`build`/`test`/`typecheck`) fan out via `pnpm -r`; library-specific ones (`coverage`/`check`/`api:*`/`docs:check`) target `pnpm --filter distillate`; `changeset`/`version`/`release` run at root.

## Packaging

- Bundler: tsdown (Rolldown/Oxc) with `isolatedDeclarations: true`. tsup as fallback.
- Dual ESM/CJS, ESM-first. `"type": "module"`, `"sideEffects": false`, zero runtime deps.
- `exports` map: `types` condition first per entry; separate `.d.ts` (ESM) and `.d.cts` (CJS); one subpath per structure plus a barrel root; export `./package.json`.

```jsonc
"exports": {
  ".":            { "types": {"import":"./dist/index.d.ts","require":"./dist/index.d.cts"}, "import":"./dist/index.js", "require":"./dist/index.cjs" },
  "./bloom":      { "types": {"import":"./dist/bloom.d.ts","require":"./dist/bloom.d.cts"}, "import":"./dist/bloom.js", "require":"./dist/bloom.cjs" },
  "./cuckoo":     { /* ... */ },
  "./binary-fuse":{ /* ... */ },
  "./package.json": "./package.json"
}
```

Keep each subpath a separate bundler entry (independent chunks; no barrel pulling everything in). No top-level side effects.

Shipped `dist/*.js` is **not minified** (tsdown default). Consumers bundle and minify downstream, and readable installed source aids debugging, so minifying here would trade that away for no consumer benefit.

TSDoc, however, is stripped from the JS: `outputOptions: { comments: false }` in `tsdown.config.mjs`. **Do not turn this back on.** Rolldown preserves doc comments by default, and they were reaching every consumer's runtime bundle, not just the installed source. Documenting the six serialization errors in the shared `serialize` chunk added ~1.9 KB raw to all three subpaths at once and broke every budget; the export statements themselves cost only ~286 bytes. Turning comments off cut `./bloom` from 23018 to 18387 raw bytes and `./blocked` from 24630 to 19184, because the pre-existing TSDoc was shipping too. The `.d.ts` files keep every comment, so IntelliSense, `docs:check`, and the generated API reference are unaffected.

## Bundle size

The "small" claim is enforced, not asserted. `pnpm size:check` (`scripts/size-check.mjs`, zero deps) measures each `exports` subpath's transitive static-import closure (entry plus the shared chunks it pulls in) as raw and gzipped bytes, and fails if any exceeds its budget in `size-budget.json`. The CI build job runs it right after `pnpm build`, so an accidental size regression fails the build. Budgets are keyed by subpath (stable); the hashed chunk filenames are resolved at runtime, so they never need updating. An `exports` entry with no budget fails the check, forcing a conscious budget for every new subpath. Intentional growth means bumping the budget in the same change, deliberately.

## Testing

- Framework runs unmodified on Node/Bun/Deno: tests written against `Uint8Array` and Web APIs, no Node `Buffer`/`fs` in core.
- Property-based (fast-check):
  - No false negatives (the defining invariant): every inserted key returns `has() === true`.
  - Serialize round-trip: `fromBytes(toBytes(f))` answers identically and bytes are identical.
  - Malformed-input rejection (see serialization.md).
  - Cuckoo delete correctness; insert-when-full signals failure, never corrupts.
- Statistical FPR suite (seeded, m >= 1e6): empirical FPR within a binomial-derived tolerance of theory (e.g. <= 1.25x theoretical), and not suspiciously low (guards a broken query path). Deterministic in CI; unseeded nightly across many seeds.

## Benchmarking

`pnpm bench` runs the package microbenches; mitata is the timing engine, and every script prints `envBanner()` (runtime + version + CPU) first.

- Regenerating `apps/bench/RESULTS.md` is a different command: `pnpm --filter distillate-bench bench`, the cross-library harness. It needs a built `distillate` in the same tree, and it must run on an otherwise idle machine, since concurrent load skews the throughput table (the space and accuracy table is seeded and stable). Its raw output is not Prettier-clean, so follow it with `pnpm format` or `format:check` fails.

- Harness (`bench/harness.ts`): shared primitives so every bench measures by identical code: `hitMissPools` (disjoint hit/miss pools), `cycle`, `benchLookup` (cycle keys through `has()`, consume via `do_not_optimize`), `measureFpr` (empirical FPR of a built filter over a disjoint miss set), `countCollections` (garbage collections caused by a loop, see below).
- Metrics, space/accuracy first: `bench/accuracy.bench.ts` reports target vs measured FPR (over a >= 1e6 disjoint miss set) and analytic bits/key (`backing.byteLength * 8 / n`, not `process.memoryUsage`) across a 1e4/1e5/1e6 sweep; then throughput as separate `add` / `has (hit)` / `has (miss)` benches plus build for static filters.
- Sketch metrics (`bench/hll.bench.ts`, `bench/cardinality.ts`): measured relative error against the analytic `1.04 / sqrt(2^p)` bound across a precision x cardinality sweep, and bytes per sketch in each encoding. Space is the serialized frame length (`toBytes().length`), the sketch equivalent of analytic bits/key: exact, identical across runtimes, and unaffected by when GC last ran. `tests/bench/cardinality.test.ts` turns the same sweep into a CI gate, bounding every point at `3 * targetError` and the _mean signed_ error at 1 percent, so a uniformly biased estimator fails even where each point stays inside its bound.
- Anti-optimization: distinct-key pools (never a constant key), keys cycled so V8 can't constant-fold, results consumed with `do_not_optimize`, distinct-key inserts.
- Machine disclosure: absolute throughput is machine-relative, so published numbers must state the machine and lead with the machine-independent metrics (bits/key, measured FPR).

### Measured: HyperLogLog

`node v24.14.1 | arm64 | Apple M5 | 10 cores`. Error and bytes are machine-independent and reproducible; the timings are not.

```
p   n        target   measured  bytes
10  1,000    3.25e-2  2.20e-2   794
10  10,000   3.25e-2  9.10e-3   794
10  100,000  3.25e-2  1.44e-2   794
12  1,000    1.63e-2  2.50e-2   3,098
12  10,000   1.63e-2  8.40e-3   3,098
12  100,000  1.63e-2  4.14e-3   3,098
14  1,000    8.13e-3  0.00e+0   4,026
14  10,000   8.13e-3  4.60e-3   12,314
14  100,000  8.13e-3  8.19e-3   12,314
```

Mean signed error over the sweep is 0.27 percent and the worst point sits at 1.54x its bound, against gates of 1 percent and 3x.

Two rows are worth reading twice. At `p=14, n=1,000` the error is exactly zero: the sketch is still sparse, so it counts rather than estimates. And that same row costs 4,026 bytes against 12,314 once dense, which is the sparse representation paying for itself. Sparse size tracks the key count, not the precision: 100 keys serialize to 426 bytes at every precision.

```
hll add (dense)      34.89 ns/iter
hll count (dense)    19.52 us/iter
hll count (sparse)  212.41 ns/iter
```

`count` is far slower than `add` because it walks all `2^p` registers to build the histogram, where `add` touches one. Sparse `count` is ~90x faster still, having only its entries to fold.

### Allocation: what "allocates nothing" covers

`add` allocates nothing per key once V8 has TurboFan-optimised the hash path, and that is the whole of the claim. Below that tier it does allocate, mostly one `TextEncoder.encodeInto` result object per key: `encodeInto` returns `{ read, written }`, `encodeKey` reads only `.written`, and escape analysis removes the object only where the chain is inlined. Maglev does not do it.

GCs per 2M `add()` calls, measured on the built bundle:

| Tier                        | GCs per 2M |
| --------------------------- | ---------- |
| TurboFan (default)          | 0          |
| Maglev only (`--max-opt=1`) | 279        |
| No opt (`--max-opt=0`)      | 279        |

Steady state is clean everywhere it was tried, so the allocating tier is a warm-up condition and not a caller shape the library exposes. Bytes/op after warm-up, by caller: monomorphic 0.009, megamorphic receiver 0.000, polymorphic across four structures 0.000, `add` buried in a caller too fat to inline 0.000. By key: ASCII 0.009, varying length 1.602, non-ASCII 0.000, emoji surrogate pairs 0.346, keys over 256 bytes 0.000, pre-encoded bytes 0.000.

The probe gets its own vitest project at `maxWorkers: 1`. Workers competing for CPU do not make the measurement noisier, they change what it measures: under load V8 declines to inline the hash path, and `add` then really does allocate per key. Forcing the tier does not help, because `%OptimizeFunctionOnNextCall` reaches the tier but not the inlining decision, and the chain below `add` is module-private.

A project with `maxWorkers: 1` lands in vitest's sequential group, which is ordered after every other group, so the probe runs on its own at the end while the rest of the suite still runs in parallel. Measured over 30 full-suite runs each: 1 failure in 30 with everything parallel, 0 in 30 with the whole suite serialised (5.6s), and 0 in 30 with just the probe split out (2.1s against 1.9s fully parallel).

The gate is `tests/hll/allocation.test.ts` over `countCollections`, which warms 500k calls and then counts only gc entries whose `startTime` falls inside the measured window. It asserts a binary, not a magnitude: the same allocating loop causes 25 collections in a quiet process and 5 in a busy one, because V8 grows the young generation as it goes.

Replacing `encodeInto` with a hand-rolled UTF-8 encoder was considered and rejected. It does not deliver zero allocation below TurboFan: byte keys never reach `encodeInto` and still cost 221 GCs against string keys' 279, so the encoder is about a fifth of the sub-TurboFan garbage and the rest is number boxing TurboFan also removes. That buys a fifth of the garbage in a tier shipped code does not sit in, against owning UTF-8 correctness (surrogate pairs, lone surrogates to U+FFFD) in the hashing path, where an error silently changes every hash and every serialized filter.

The hash path is shared, so this is a library-wide property rather than an HLL one: under Maglev, bloom 200, blocked 141, fuse 230.

## Documentation site

`apps/docs` (`distillate-docs`, private): Astro + Starlight, built statically to `apps/docs/dist`. `pnpm typecheck` there is `astro check`, which covers `.astro` files `tsc` cannot.

- Search is Pagefind, which Starlight enables by default and indexes from the built HTML. No configuration.
- `site` is exported once, from `apps/docs/astro.config.mjs`, holding `https://distillate.akxp.net`. Deploys target a host root, never a subdirectory, so `base` stays unset and the absolute `/_astro/...` paths Astro emits resolve (Astro has no relative-asset mode; `build.assetsPrefix` is for CDNs, not relative paths).
- `disable404Route: true` alongside `src/content/docs/404.md`: Starlight's built-in `/404` route and the `/404` its catch-all route derives from that file are duplicates, and Astro 7 warns on the conflict. The authored page also needs `sidebar.hidden`, since Astro emits it as `404.html` and a sidebar link to `/404/` would dead-end.
- The API reference is generated by `starlight-typedoc` at build time into `apps/docs/src/content/docs/api/`, which is gitignored and prettier-ignored. Nothing generated is committed.
- The undocumented-export gate is a separate `typedoc --emit none` run (`pnpm docs:check`, driven by `packages/distillate/typedoc.json`), not a property of the docs build. `starlight-typedoc` never calls `app.validate()`, and typedoc enforces `treatWarningsAsErrors` only in its CLI, so both options are inert when typedoc is driven as a library. A missing TSDoc comment leaves the site build green.
- `apps/docs/tsconfig.json` (extends `astro/tsconfigs/strict`) is load-bearing: the root ESLint config points `parserOptions.project` at it for every `.ts` under `apps/docs`, so type-aware linting breaks without it. Astro's generated `apps/docs/.astro/` types are ignored at the root instead.

## CI (GitHub Actions)

1. Typecheck + lint (`tsc --noEmit`, oxlint).
2. Test matrix: Node LTS + current, Bun, Deno (Linux; Node also macOS/Windows). Includes a smoke import test per runtime to prove the exports map resolves.
3. FPR statistical suite (seeded).
4. Package validation gate: build, `npm pack`, `publint`, `@arethetypeswrong/cli --pack`. Both tools; they catch different things.
5. mitata regression vs base branch.
6. Release: tag-triggered, npm Trusted Publishing (OIDC, `id-token: write`, npm >= 11.5.1), automatic provenance.

## Semver

Pre-1.0 during Phase 0/1. 1.0 is the lean production commitment (see overview.md). Serialization format version is independent of package semver; bump only on incompatible layout changes.

## Releasing (Changesets)

Versioning and the changelog are driven by [Changesets](https://github.com/changesets/changesets).

- Every user-facing change adds a changeset: run `pnpm changeset`, pick the bump (patch/minor/major), and write a one-line summary. Commit the generated `.changeset/*.md` file with the change.
- Non-user-facing changes (docs, CI, internal refactors) add an empty changeset: `pnpm changeset add --empty`. CI requires one or the other on every PR.
- Do not hand-edit `package.json` version or `CHANGELOG.md`. `pnpm version` (`changeset version`) consumes pending changesets, bumps semver, and writes the changelog; the release workflow runs this and publishes.

### The publish path needs a clean changeset set

`changesets/action` publishes only when `main` has no pending changesets. Any changeset present, even an empty one, routes it onto the version path, where an all-empty set logs `All changesets are empty; not creating PR` and exits without running `publish-script`.

Normally this is invisible, because the Version Packages merge is itself the zero-changeset push that publishes. It bites when a publish fails: the fix PR carries the usual empty changeset and so blocks the very publish it was meant to restore. Recovery means landing a commit on `main` with no changesets at all, so the recovery PR omits the empty one. `changeset status --since=origin/main` still exits 0 in that case, so the required check passes.

### Pre-publish checklist

Before cutting a release, confirm:

- [ ] `pnpm build` succeeds and `pnpm test` is green.
- [ ] `pnpm check` (publint + attw `--profile node16`) passes.
- [ ] `npm publish --dry-run` lists `dist/` plus `package.json`/`README.md`/`LICENSE` only (no `src/`, `tests/`, `bench/`, `.changeset/`).
- [ ] Version and `CHANGELOG.md` were bumped by changesets, not by hand.
- [ ] CI is green on `main` (test matrix + cross-runtime smoke).
- [ ] For the first publish only: npm Trusted Publishing is configured for the package (GitHub Actions, `akshay-xp/distillate`, `release.yml`).
