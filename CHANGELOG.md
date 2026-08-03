# distillate

## 0.1.2

### Patch Changes

- 52ecd88: Document the entire public API with TSDoc. Type declarations (`.d.ts`) now ship inline docs, so editors surface a description, `@param`/`@returns`, and usage examples on hover and autocomplete for every exported member. A browsable API reference generated from these comments is also published in the repo under `docs/api`.
- 39ef6f7: Derive `VERSION` from `package.json` so it can no longer drift out of sync. Its type widens from the `"x.y.z"` string literal to `string`.

## 0.1.1

### Patch Changes

- f723db3: Faster, allocation-free key hashing on the membership hot path. String `has`/`add` are ~1.7x faster (the per-op UTF-8 encode buffer is now reused instead of allocated), and the 128-bit hash result is written into reused scratch instead of a fresh object per call, so steady-state `has`/`add` allocate at the GC noise floor. Hash values are unchanged, so existing serialized filters remain byte-compatible and cross-language readable.

## 0.1.0

### Minor Changes

- Initial pre-release. Three approximate-membership structures, each on its own subpath with a versioned AMQF binary format (`toBytes` / `fromBytes`):

  - `distillate/bloom`: Classic Bloom filter.
  - `distillate/blocked`: Blocked Bloom filter (cache-line-local lookups).
  - `distillate/fuse`: Binary Fuse 8/16 (static, space-efficient, built once via `from`).
