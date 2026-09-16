---
"distillate": minor
---

Binary format version 5: every payload is now 8-byte aligned.

Each type's params block is padded to a multiple of 8, so a payload always begins at a frame offset that is a multiple of 8 and a reader in any language can map it as a typed slice instead of copying. HyperLogLog's sparse entries are `u32` and sat at offset 22 through version 4, which no language permits a typed view over; the other payloads were aligned only by the accident of their lane widths. `writeFrame` now refuses a params block that would unalign the payload, and readers reject a frame whose params padding is not zero.

**Breaking.** Frames written by earlier versions are rejected with `UnknownVersionError`. Re-serialize stored filters and sketches with this release. Frame sizes grow by 2 bytes for Bloom and HyperLogLog and 4 for Blocked; Binary Fuse is unchanged.
