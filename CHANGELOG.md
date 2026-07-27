# siftr

## 0.1.0

### Minor Changes

- Initial pre-release. Three approximate-membership structures, each on its own subpath with a versioned AMQF binary format (`toBytes` / `fromBytes`):

  - `siftr/bloom`: Classic Bloom filter.
  - `siftr/blocked`: Blocked Bloom filter (cache-line-local lookups).
  - `siftr/fuse`: Binary Fuse 8/16 (static, space-efficient, built once via `from`).
