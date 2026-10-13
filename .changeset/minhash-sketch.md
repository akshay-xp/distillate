---
"distillate": minor
---

Add MinHash at `distillate/minhash`: a similarity sketch that estimates the Jaccard similarity of two sets from `k` slots each, and `MinHashLSH`, an index that finds the stored sets likely to resemble a query without comparing every pair.

`new MinHash({ k, seed })`, `MinHash.create(maxError)` and `MinHash.from(keys, maxError)` build a sketch (`k` from 2 to 4096, 128 by default). It has `add`, `jaccard`, `union`, `equals`, `signature`, `standardError` and `isEmpty`, and binary and JSON serialization as frame type 11. `union` is exact: two merged sketches hold the slots one sketch fed both sets would hold. `minHashSizing(maxError)` picks `k`.

`new MinHashLSH({ threshold, k, weights, seed })` cuts signatures into bands, with `insert`, `query`, `remove`, `has` and `size`. `lshSizing(threshold, k, weights)` picks the bands and rows as datasketch does, minimising weighted false-positive and false-negative area, and reports both.

Three behaviours worth knowing:

- Each item costs one hash (one-permutation hashing), not `k`. A set smaller than `k` leaves slots empty, which are filled when compared, so its estimate stays unbiased but carries about 1.3 times the error.
- The index returns likely matches, not confirmed ones: at the default weights a pair just above the threshold is a candidate most of the time, not always. Check candidates with `jaccard` where it matters. The index is not serialized; persist the sketches and insert them again.
- The hash is seeded, not keyed, so items crafted against a known seed can crowd the index's bands. Use a private seed when the items come from people who may want that.
