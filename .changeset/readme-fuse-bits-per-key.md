---
"distillate": patch
---

Correct the README's three-key Binary Fuse sample, which claimed `~9` bits per key where the real value is 64. The `~9` figure is the asymptote a filter approaches at large `n`; at three keys the fingerprint array is at its fixed minimum. The sample now quotes the allocated cost and explains the difference.
