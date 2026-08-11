---
"distillate": minor
---

Correctness and API hardening:

- `BlockedBloomFilter.create` now sizes bits-per-key by solving the split-block false-positive rate in closed form, so it hits the target rate across the full epsilon range (previously values like `0.1` were silently under-provisioned to ~18%). Targets below the solvable floor throw a `ParamError` rather than returning a degraded filter. The bits-per-key chosen for a given epsilon may differ from before.
- Filter constructors now reject parameters that exceed their serialized field widths (`k > 65535`, `m`/`capacity > 2^32-1`) with a `ParamError`, instead of silently truncating on serialize.
- New accessors for compatibility prechecks: `numBlocks` and `seed` on `BlockedBloomFilter`, and `seed` on `BinaryFuse8`/`BinaryFuse16`.
- `toBytes` writes into a single allocated frame, dropping the duplicate body buffer.
