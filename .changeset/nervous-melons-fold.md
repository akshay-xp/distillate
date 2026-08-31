---
"distillate": patch
---

`HyperLogLog.fromBytes` rejects a sparse frame whose entry carries a rho the precision cannot produce, with `SerializationError`.

A sparse entry is `index << 6 | rho`. The index half was validated as of the last release, via a 31-bit width check, and the rho half was not, leaving the sparse read path asymmetric with the dense one directly above it, which has always held its registers to `65 - p`.

The gap was reachable only from a forged frame, and it did not throw. A frame carrying oversized rhos loaded clean, counted correctly, and round-tripped equal to itself, because nothing on the sparse path reads rho. The damage arrived later, when enough keys promoted the sketch and `foldSparse` wrote those rhos into registers: at `p = 14` with 3,000 keys forged to rho 63, the count went on to overstate by 16% (119,223 against a true 102,580) with no error raised. Worse, the frame such a sketch then wrote was one `fromBytes` refused, so a caller could hold a live sketch that could not be persisted.

Rejecting on load closes both. Only the upper bound is checked: a rho of 0 is a legitimate dense register value, so rejecting it on one encoding and not the other would reintroduce the same asymmetry.

No effect on frames written by any release.
