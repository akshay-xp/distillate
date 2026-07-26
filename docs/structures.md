# Structures

Space is stated as overhead over the information-theoretic floor of `log2(1/epsilon)` bits/key (6.64 bpk at 1%, 9.97 bpk at 0.1%).

## Decision matrix (the library's guiding star)

| Workload | Use |
|---|---|
| Static set, built once, queried a lot | Binary Fuse 8 (fuse 16 for lower FPR) |
| Squeeze every bit, static, RAM-bound | Ribbon/BuRR (post-1.0) |
| Streaming inserts, speed-first, no delete | Blocked Bloom |
| Inserts + deletes | Cuckoo |
| Unbounded growth, n unknown | Scalable Bloom (v1); InfiniFilter/Aleph (later) |
| Very low FPR (<= 1e-4) | Binary Fuse 16/32 |
| Migration from bloom-filters | Classic / Counting / Scalable Bloom |

## v1.0 lineup

### Blocked Bloom (mutable default)
One cache line per lookup vs k cache misses for classic. Space penalty ~20-30% over classic, bought back in speed. SIMD-friendly for a later WASM path.
Putze, Sanders, Singler, JEA 2009.

### Classic Bloom (mutable, migration)
1.44x floor (+44% overhead), fixed forever. Ubiquitous, zero build risk, mergeable at equal params. Kept for familiarity and the migration path.
Bloom, CACM 1970.

### Counting + Scalable Bloom (mutable, migration)
Counting: 4-bit counters enable delete at ~4x space. Scalable: chain of Blooms for unbounded growth. Both mainly for parity with incumbents.

### Cuckoo (mutable + delete)
Fingerprints in a cuckoo table, buckets of 4, partial-key hashing. ~log2(1/epsilon)+3 bpk, two bucket probes, load cap ~95% (insert can fail; must signal, never corrupt). Ships correct: no-false-negative property test is a headline vs the incumbent bug.
Fan, Andersen, Kaminsky, Mitzenmacher, CoNEXT 2014.

### Binary Fuse 8/16 (static, headline feature)
Peeling-built, 3 cache-local probes. ~1.08-1.13x floor (~9% overhead), smaller and faster than XOR, low build failure and peak memory. 8-bit -> epsilon ~0.39%; 16-bit -> ~1/65536. The best static AMQ and the thing nobody ships in JS.
Graf and Lemire, JEA 2022 (arXiv 2201.01174). Reference: FastFilter/xorfilter.

### XOR 8/16 (optional, comparison)
~1.23x (XOR) / ~1.08x (XOR+). Superseded by Fuse; include only for completeness/benchmarking.
Graf and Lemire, JEA 2020.

## Deferred (post-1.0, differentiation + research)

- Ribbon / Homogeneous / BuRR: banded linear system, sub-1% space overhead, faster than Bloom. Min-space static. RocksDB ships Ribbon. Dillinger et al. 2021; SEA 2022 (arXiv 2109.01892); lorenzhs/BuRR.
- InfiniFilter (SIGMOD 2023) / Aleph (VLDB 2024): expandable mutable filters, constant-time growth. For unknown-cardinality streaming.
- Morton: compressed sparse cuckoo, bandwidth-bound throughput. PVLDB 2018.
- CQF: counting quotient filter, multiset + delete at ~2.1 bits overhead. SIGMOD 2017.

## Related

- [architecture.md](architecture.md), [hashing.md](hashing.md)
- Tutorial overview: Pandey/Chen et al., "Beyond Bloom", SIGMOD 2024.
