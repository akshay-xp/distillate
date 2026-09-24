---
"distillate": patch
---

Every sizing subpath is smaller: a subpath no longer ships the sizing helpers belonging to other structures.

`hllSizing` and `countMinSizing` lived in one internal module alongside `bloomSizing`, which bundles as a single chunk that each importing subpath downloads whole. So `distillate/bloom` carried the HyperLogLog and Count-Min solves, `distillate/hll` carried the Bloom and Count-Min ones, and so on. Each helper now lives with the structure it sizes, as `cuckooSizing` already did.

Measured on the built bundles, raw and gzipped:

```
./bloom     21942 -> 21246    gzip 6366 -> 6180
./hll       27666 -> 27074    gzip 7849 -> 7684
./scalable  28491 -> 27795    gzip 8080 -> 7885
./countmin  23747 -> 23079    gzip 6727 -> 6538
```

No public API changed. Every helper is exported from the same subpath under the same name, and the import paths in your code are unaffected.
