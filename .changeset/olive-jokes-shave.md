---
"distillate": minor
---

Bump the binary format to version 4: rename the frame magic from `AMQF` to `DSTL`, and add a 32-bit body-length field to the header.

**Breaking.** Frames written by earlier versions are rejected with `BadMagicError`, and there is no dual-magic read path. Re-serialize any persisted filters with this version.

`AMQF` stood for _Approximate Membership Query Filter_, which stops being accurate as `distillate` grows beyond membership filters into probabilistic structures generally. The magic is published in a cross-language format spec, so it was fixed while the package is still pre-1.0 rather than left to outlive the assumption behind it.

The header is now 16 bytes and carries the body length at offset 8, so a reader can validate, skip, or stream a frame of a structure type it does not implement, using the header alone. Previously body length was inferred from each type's params, which made the format unreadable by anything generic. The length is checked before the CRC, so a frame cut short in transit now reports `TruncatedError` rather than a checksum failure.
