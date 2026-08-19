# distillate

[![CI](https://github.com/akshay-xp/distillate/actions/workflows/ci.yml/badge.svg)](https://github.com/akshay-xp/distillate/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/distillate)](https://www.npmjs.com/package/distillate)
[![license](https://img.shields.io/npm/l/distillate)](./LICENSE)

Probabilistic data structures for JavaScript: space-efficient, approximate-membership filters (Bloom, Blocked Bloom, Binary Fuse) with tunable error and **zero false negatives**. TypeScript-first, zero runtime dependencies, and universal (Node, Bun, Deno, browser, edge).

> **Pre-release (0.x).** The published structures are correct, tested, and benchmarked, but the public API may still change before `1.0`. Pin a version if you depend on it.

Full install, usage, runtime support, and benchmarks are in the [package README](./packages/distillate/README.md).

## Repository

This is a pnpm workspace.

| Package                               | Path                  | Description                                                                                                           |
| ------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| [`distillate`](./packages/distillate) | `packages/distillate` | The published library.                                                                                                |
| `distillate-bench` (private)          | `apps/bench`          | Cross-library benchmark (vs `bloom-filters` / `bloomfilter.js`) on `workspace:*`, so it always measures local source. |

### Development

```sh
pnpm install      # sets up git hooks (Husky)
pnpm build        # tsdown, across packages
pnpm test         # Vitest, across packages
pnpm lint         # type-aware ESLint
pnpm format:check
```

Library-specific tasks target the package: `pnpm --filter distillate <coverage|check|api:check|docs:check|bench>`. Releases run through [Changesets](https://github.com/changesets/changesets) at the root (`pnpm changeset`). See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Docs

Design notes, the structure decision matrix, hashing, and the binary format live under [`packages/distillate/docs`](./packages/distillate/docs):

- [overview](./packages/distillate/docs/overview.md): what and why
- [structures](./packages/distillate/docs/structures.md): decision matrix and the full lineup
- [architecture](./packages/distillate/docs/architecture.md), [hashing](./packages/distillate/docs/hashing.md), [serialization](./packages/distillate/docs/serialization.md)
- [API reference](https://distillate.akxp.net/api/): generated from TSDoc at site build time

## License

[MIT](./LICENSE) © Akshay
