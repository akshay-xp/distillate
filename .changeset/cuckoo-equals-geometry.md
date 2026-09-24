---
"distillate": patch
---

Fix `CuckooFilter.equals` returning `true` for two filters that serialize to different bytes.

`equals` compared `n`, `epsilon`, `seed`, `count` and the slot words, but not the stored fingerprint width `f` or bucket count. That was sound while `fromBytes` derived the geometry from `n` and `epsilon`; since 0.12.0 it trusts the geometry the frame stores, so two frames can agree on everything `equals` looked at while splitting the same total bits differently, for example `f=10 buckets=11` against `f=5 buckets=22`. `equals` now compares both, restoring the documented guarantee that it is exactly byte equality of the frame.

Reaching it needed a frame whose geometry was edited by hand, so filters built through `create` and `from` were never affected.
