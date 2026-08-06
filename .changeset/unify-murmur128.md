---
"distillate": minor
---

Unify all structures on murmur3_x86_128 and bump the serialization format to version 3.

One hash (murmur3_x86_128, pure `Math.imul`, single pass) now backs Bloom, Blocked, and Fuse, replacing the two-pass murmur3_x86_32 and the emulated MurmurHash3_x64_128. On Apple M5 this is ~2x faster Fuse queries and ~1.3x faster Bloom/Blocked lookups.

Breaking: this is a format change. Filters serialized by earlier versions (format v2) are rejected on read with `UnknownVersionError`; re-serialize with this version. Fuse frames now carry a hash-variant guard they previously lacked.
