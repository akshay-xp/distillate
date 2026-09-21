---
"distillate": minor
---

Add `distillate/frame` with `readFrameAt(bytes, offset)`, which validates one frame inside a larger buffer without knowing its type and returns its `byteLength`, so a buffer of concatenated frames can be walked. `fromBytes` still accepts exactly one whole frame.
