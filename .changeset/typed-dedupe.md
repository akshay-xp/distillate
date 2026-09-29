---
"distillate": patch
---

`CuckooFilter.from`, `BinaryFuse8.from` and `BinaryFuse16.from` build faster and in far less memory. They drop repeated keys through a typed-array set of hashes instead of a `Set` of formatted strings, and Cuckoo's `from` no longer hashes every key a second time. Results and bytes are unchanged: the same keys give the same filter as before.

Measured at 5,000,000 string keys, each in a fresh process, where the keys alone take 0.37 GB:

| Build               | Time             | Peak memory        |
| ------------------- | ---------------- | ------------------ |
| `CuckooFilter.from` | 4.30 s to 1.29 s | 2.33 GB to 0.77 GB |
| `BinaryFuse8.from`  | 3.66 s to 1.67 s | 1.38 GB to 0.78 GB |

`CountMinSketch.from` is unaffected: it counts repeats rather than dropping them.
