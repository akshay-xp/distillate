---
"distillate": minor
---

Export the six serialization errors `fromBytes` and `fromJSON` throw, so a
consumer can tell decode failures apart with `instanceof`: `SerializationError`
and its subclasses `TruncatedError`, `BadMagicError`, `UnknownVersionError`,
`UnknownHashVariantError`, and `ChecksumError`. All six are available from
`distillate/bloom`, `distillate/blocked`, and `distillate/fuse`.

Every published subpath also got substantially smaller. TSDoc was being
preserved in the shipped JS, not just in the type declarations, so each
consumer's runtime bundle carried the full doc comments. It is now stripped
from the JS and kept in the `.d.ts`, leaving editor hovers and the generated
API reference unchanged:

| Subpath              | Raw            | Gzipped      |
| -------------------- | -------------- | ------------ |
| `distillate/bloom`   | 23018 -> 18387 | 7255 -> 5432 |
| `distillate/blocked` | 24630 -> 19184 | 7855 -> 5700 |
| `distillate/fuse`    | 25704 -> 21157 | 7897 -> 6152 |

Public documentation now lives at https://distillate.akxp.net, with guides per
structure, sizing, cross-runtime usage, migration from `bloom-filters`, and
reference pages for the binary format, versioning, and every error class.
