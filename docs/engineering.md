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

- mitata (deopt/GC-aware) is authoritative; run on Node + Bun + Deno. tinybench for quick local checks.
- Metrics: insert and `has()` ops/sec (hit and miss paths separate); construction throughput + Cuckoo failure rate; analytic bits/key (`backing.byteLength * 8 / n`, not `process.memoryUsage`); empirical FPR-vs-space curve.
- Traps: consume results (avoid dead-code elimination), discard warmup, keep monomorphic (one type per bench), pre-allocate keys outside the timed loop, use non-constant inputs.

## CI (GitHub Actions)

1. Typecheck + lint (`tsc --noEmit`, oxlint).
2. Test matrix: Node LTS + current, Bun, Deno (Linux; Node also macOS/Windows). Includes a smoke import test per runtime to prove the exports map resolves.
3. FPR statistical suite (seeded).
4. Package validation gate: build, `npm pack`, `publint`, `@arethetypeswrong/cli --pack`. Both tools; they catch different things.
5. mitata regression vs base branch.
6. Release: tag-triggered, npm Trusted Publishing (OIDC, `id-token: write`, npm >= 11.5.1), automatic provenance.

## Semver

Pre-1.0 during Phase 0/1. 1.0 is the lean production commitment (see overview.md). Serialization format version is independent of package semver; bump only on incompatible layout changes.
