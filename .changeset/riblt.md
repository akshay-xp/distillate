---
"distillate": minor
---

Add rateless set reconciliation (RIBLT) at `distillate/riblt`: two peers holding similar key sets learn exactly which keys each alone holds, sending bytes that follow the size of the difference rather than the sets, with no estimate of it up front.

`RibltEncoder.from(keys, { seed })` turns a set into an endless stream of 20-byte coded symbols; `take(n)` returns the next `n` as one frame and `stream(n)` yields frames forever. `RibltDecoder.from(keys, { seed })` holds the other side: `push(frame)` ingests frames in order and reports whether it has `decoded`, then `local()` returns the keys only it holds and `remote()` the peer's as 64-bit hashes, which the peer maps back with `RibltDecoder.hashOf`. Frames are frame type 12; a frame from another seed throws `RibltParamMismatchError`, and an out-of-order one `ParamError`, both leaving the decoder as it was. A large difference costs about 28 bytes per differing key.

Three behaviours worth knowing:

- Keys must be distinct. A repeated key, or two keys on one side sharing a 64-bit hash, would keep the decode from ever finishing, so the first `take` or `push` on that side throws `ParamError`; deduplicate, or pick another seed for a collision.
- `remote()` returns hashes, not keys: the decoder never saw the peer's keys. Resolving them costs the peer one more message.
- The hash is seeded, not keyed, so keys crafted against a known seed can stall a decode. Use a private seed when the keys come from people who may want that, and cap the frames you accept.
