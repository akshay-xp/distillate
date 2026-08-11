---
"distillate": patch
---

Fix `BloomFilter.union` reporting the wrong `bitsPerKey`/`rate` and breaking `equals`: the result now carries the operand's expected-key count instead of re-deriving it from `m/k` (membership was never affected). `BloomFilter.create` now rejects `n` above `2^32-1` with a `ParamError` instead of silently truncating it into the serialized frame.
