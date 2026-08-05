---
"distillate": minor
---

Swap the Bloom and Blocked probe hash to murmur3_x86_32, roughly 5x faster on short keys and 11x on long keys, with an unchanged false-positive rate. Fuse is unaffected.

**BREAKING:** Bloom and Blocked filters serialized before this release (hash variant 0) can no longer be read; `fromBytes` rejects them with `UnknownHashVariantError`. The serialized layout and format version are unchanged; the hash variant is recorded in the header flags nibble. Re-serialize any persisted Bloom/Blocked filters after upgrading. Binary Fuse frames are unaffected and remain readable.
