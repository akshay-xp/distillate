# Engineering

Packaging, testing, benchmarking, CI, release. Targets 2026 tooling.

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

## Testing

- Framework runs unmodified on Node/Bun/Deno: tests written against `Uint8Array` and Web APIs, no Node `Buffer`/`fs` in core.
- Property-based (fast-check):
  - No false negatives (the defining invariant): every inserted key returns `has() === true`.
  - Serialize round-trip: `fromBytes(toBytes(f))` answers identically and bytes are identical.
  - Malformed-input rejection (see serialization.md).
  - Cuckoo delete correctness; insert-when-full signals failure, never corrupts.
- Statistical FPR suite (seeded, m >= 1e6): empirical FPR within a binomial-derived tolerance of theory (e.g. <= 1.25x theoretical), and not suspiciously low (guards a broken query path). Deterministic in CI; unseeded nightly across many seeds.

## Benchmarking

`pnpm bench` runs the suite; mitata is the timing engine, and every script prints `envBanner()` (runtime + version + CPU) first.

- Harness (`bench/harness.ts`): shared primitives so every bench measures by identical code: `hitMissPools` (disjoint hit/miss pools), `cycle`, `benchLookup` (cycle keys through `has()`, consume via `do_not_optimize`), `measureFpr` (empirical FPR of a built filter over a disjoint miss set).
- Metrics, space/accuracy first: `bench/accuracy.bench.ts` reports target vs measured FPR (over a >= 1e6 disjoint miss set) and analytic bits/key (`backing.byteLength * 8 / n`, not `process.memoryUsage`) across a 1e4/1e5/1e6 sweep; then throughput as separate `add` / `has (hit)` / `has (miss)` benches plus build for static filters.
- Anti-optimization: distinct-key pools (never a constant key), keys cycled so V8 can't constant-fold, results consumed with `do_not_optimize`, distinct-key inserts.
- Machine disclosure: absolute throughput is machine-relative, so published numbers must state the machine and lead with the machine-independent metrics (bits/key, measured FPR).

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

### Pre-publish checklist

Before cutting a release, confirm:

- [ ] `pnpm build` succeeds and `pnpm test` is green.
- [ ] `pnpm check` (publint + attw `--profile node16`) passes.
- [ ] `npm publish --dry-run` lists `dist/` plus `package.json`/`README.md`/`LICENSE` only (no `src/`, `tests/`, `bench/`, `.changeset/`).
- [ ] Version and `CHANGELOG.md` were bumped by changesets, not by hand.
- [ ] CI is green on `main` (test matrix + cross-runtime smoke).
- [ ] For the first publish only: npm Trusted Publishing is configured for the package (GitHub Actions, `akshay-xp/distillate`, `release.yml`).
