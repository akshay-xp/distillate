---
"distillate": minor
---

Add the Top-K sketch at `distillate/topk`: a heavy-hitters sketch that lists the keys seen most often, in space fixed by the error you ask for rather than by how many keys arrive.

`TopK.create(epsilon)` sizes the map so the error, `error()`, stays at most `epsilon` of the total recorded. `top(k)` takes `k` on each call, so one sketch answers a top 10 and a top 100. It has the same `create`, `from`, `equals`, `union` and binary and JSON serialization (frame type 9) as the other structures, plus `add(key, count)`, `count(key)`, `top(k)`, `total`, `error()` and `topKSizing(epsilon)`.

A key the sketch holds never reads below its true count, each entry of `top` carries a `lowerBound` never above it, and any key heavier than `error()` is guaranteed to be held. An `add` or `union` that would carry a stored count past `2**32 - 1` or the total past `2**53 - 1` throws `TopKOverflowError` and leaves the sketch untouched.

Four behaviours worth knowing:

- `top` returns each key as a `Uint8Array`, exactly as recorded. Decode string keys with `TextDecoder`.
- A Top-K frame holds the keys it counts verbatim. Every other distillate frame is one-way; this one persists user input, so treat a serialized sketch like the stream it came from.
- The map places keys with HalfSipHash under a random key each sketch draws for itself, so crafted keys cannot be made to collide and slow `add`. There is no `seed` option, and the key never reaches the frame. It is drawn on the first hash: on Cloudflare Workers, which refuse random values at module scope, build or decode a Top-K inside a handler.
- `union` is sound but, unlike Count-Min's, not byte-identical to one sketch fed both streams: Misra-Gries purges as keys arrive, so what survives depends on their order.
