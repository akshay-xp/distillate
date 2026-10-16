# Architecture

Deep modules, one narrow interface. Every structure feels identical to use.

## Four families

Static and mutable filters have honestly different lifecycles, and sketches answer a different question entirely. Do not pretend everything is a Bloom filter (the mistake incumbents make).

- Mutable: `add` (and sometimes `delete`) after construction. Bloom, Blocked Bloom, Counting Bloom, Scalable Bloom, Cuckoo.
- Static: `build(keys)` once, then immutable and queried. Binary Fuse, XOR. Smaller and faster; can fail-and-retry on build.
- Sketches: `add` then ask an aggregate question rather than a membership one. HyperLogLog (cardinality), Count-Min (frequency of a named key), Top-K (heavy hitters), DDSketch (quantiles of numbers, not keys) and MinHash (similarity of two sets).
- Reconciliation: two parties, one set each, and the exact keys that differ. RIBLT.

### Why a sketch is not a `Filter`

The split is structural, not taxonomic. `Filter` promises `has(key)` and `bitsPerKey`, and a sketch can honour neither.

A HyperLogLog does not store membership: it keeps `2^p` registers holding the longest run of leading zeros hashed to each, from which a cardinality is inferred. Nothing in there answers "did I see this key". And `bitsPerKey` has no denominator, because a sketch's size is fixed by `p` before it sees a single key. That fixed size is the entire point: 12 KiB counts a thousand distinct keys or a billion.

So sketches get their own narrow interface rather than a widened `Filter` with methods that throw. The union operation is shared in spirit but not in type: filters merge only at identical parameters, while sketches fold to the coarser precision.

### Why reconciliation is neither

A filter and a sketch are each one structure, built, queried and serialized whole. Reconciliation is a protocol between two of them: the question ("which keys do we not share?") is about two sets that never meet in one process, and the thing that crosses the wire is a stream, not a structure. So it is two halves, not one class: `RibltEncoder` turns a set into an endless stream of coded symbols (`take(n)` returns the next `n` as a frame), and `RibltDecoder` subtracts its own set from them (`push(frame)`) until it peels the difference. Neither half has `has`, `union` or `fromBytes`; a frame is a batch of the stream, read only by `push`.

Symbols are 64-bit key hashes, not keys, so every symbol is 20 bytes whatever the keys' length; `local()` maps decoded hashes back to the caller's keys by re-hashing them once, and `remote()` returns hashes for the other side to resolve with `hashOf`. A key's checksum and its index sequence are functions of its symbol alone, because the decoder only ever holds a remote symbol, never its key; the sequence's PRNG is seeded from the whole 64-bit checksum, since a 32-bit seed repeats across about n^2 / 2^33 pairs and a pair sharing a sequence never peels. Symbol words travel through `R64` and typed arrays rather than arguments, so they are not boxed when a call is not inlined.

## Interfaces

```ts
type BytesLike = string | Uint8Array | ArrayBuffer; // strings UTF-8 encoded internally

interface Filter {
  has(key: BytesLike): boolean;
  toBytes(): Uint8Array;
  readonly bitsPerKey: number; // analytic, for reporting
}

interface MutableFilter extends Filter {
  add(key: BytesLike): void;
}

interface DeletableFilter extends MutableFilter {
  delete(key: BytesLike): boolean;
}

// Static family: build-once free functions per structure
function buildBinaryFuse8(keys: Iterable<BytesLike>, opts?: BuildOpts): Filter;

// Sketch family: aggregate questions, no per-key answer and no bitsPerKey
interface Sketch<T> {
  add(key: BytesLike): void;
  toBytes(): Uint8Array;
  union(other: T): T;
}

interface CardinalitySketch extends Sketch<CardinalitySketch> {
  count(): number;
  readonly standardError: number; // analytic, for reporting
}

// Values, not keys: DDSketch takes numbers and hashes nothing, so add differs
interface QuantileSketch extends Omit<Sketch<QuantileSketch>, "add"> {
  add(value: number, count?: number): void;
  quantile(q: number): number; // within relativeAccuracy of the true value
  readonly relativeAccuracy: number;
}

// Two sets at once: the question is about a pair, so the answer takes one
interface SimilaritySketch extends Sketch<SimilaritySketch> {
  jaccard(other: SimilaritySketch): number; // within standardError of the truth
  readonly standardError: number; // 0.5 / sqrt(k), the worst case at J = 0.5
}
```

MinHash's index, `MinHashLSH`, is not a sketch: it holds keys under band hashes of
sketches and answers `query(sketch)` with candidate keys. It lives on the sketch's
subpath because it takes nothing else, and it is not serialized; the sketches are.
A bucket is an array up to 16 keys and a `Set` past that: most buckets hold one
key, where a `Set` doubled the index's heap, while near-duplicates crowd a few,
where array removal went quadratic. It bands a sketch's cached densified slots
through `denseSlots`, a module-internal accessor, not a `signature()` copy.

A sketch caches its densified slots until `add` changes a slot: densifying a
sparse sketch at k 4096 costs hundreds of ms, too much to repeat per read.

Each structure also exposes `fromBytes(bytes: Uint8Array): Filter` (static method).

Introspection accessors sit alongside the narrow interface, not in it: Bloom exposes `m`/`k`/`seed`/`length`/`rate()`, Blocked exposes `length`/`rate()`. They read back build params and current fill (`rate()` is a fill-based FPR estimate); Fuse needs none of them since it is static and reports `size`.

## Sizing helpers (first-class)

`bloomSizing(n, epsilon)` returns the params for a target count and false-positive rate. Incumbents force manual computation; this is a core ergonomics win.

A sizing helper lives with the structure it sizes, and `core/sizing.ts` keeps only helpers two or more structures import. Today that is `bloomSizing` alone, reached by `bloom/bloom.ts` and by `scalable/scalable.ts`, which builds its stages from `BitSet` and otherwise never touches `bloom/`. The rule is a bundling one: anything in `core/sizing.ts` is a chunk that every importing subpath downloads whole, so a helper parked there is shipped to consumers who cannot call it.

## Storage

- Backing: `Uint8Array` (bit array, serializable, `SharedArrayBuffer`-friendly) or `Uint32Array` for word ops.
- Bit ops unsigned: always `>>> 0`; `bit = arr[i >>> 3] & (1 << (i & 7))`.
- Bucket reduction: Lemire multiply-shift, not modulo.
- Large filters (> 2^32 bits): separate opt-in class using `Math.floor(i / 8)` index math instead of 32-bit shifts, sharded across typed arrays (single ArrayBuffer capped ~2 GiB in V8). Common small path stays in fast Number/typed-array land.

## Constraints (no compromise)

No top-level side effects. No decorators, no `reflect-metadata`, no dynamic `eval`. This is what keeps it edge-safe and tree-shakeable.

## File layout

```
src/
  core/
    bytes.ts        # BytesLike normalization, UTF-8 encode
    hasher.ts       # murmur3_x86_128, KM double hashing, Lemire reduce
    bitset.ts       # typed-array bit storage
    distinct.ts     # typed-array set of hash tuples: the from dedupe for cuckoo and fuse
    serialize.ts    # DSTL frame read/write, CRC32, shared errors
    crc32.ts        # slice-by-8 CRC32
    base64.ts       # JSON envelope encoding
    params.ts       # ParamError and argument checks
    sizing.ts       # bloomSizing only: bloom and scalable both import it
  bloom/            # classic Bloom
  blocked/          # split-block (Parquet layout) Bloom
  fuse/             # Binary Fuse 8 / 16
  hll/              # HyperLogLog: dense registers, sparse store, estimator, fold,
                    # and sizing.ts for hllSizing
  scalable/         # scalable Bloom: a chain of Bloom stages sharing one hash
  cuckoo/           # cuckoo filter with delete: cuckoo.ts, and sizing.ts for
                    # cuckooSizing
  countmin/         # Count-Min sketch: countmin.ts, and sizing.ts for countMinSizing
  topk/             # Top-K heavy hitters: topk.ts, halfsip.ts for the keyed
                    # slot hash, and sizing.ts for topKSizing
  ddsketch/         # DDSketch: ddsketch.ts (frame type 10), mapping.ts for the four
                    # index mappings, store.ts for the four stores
    protobuf/       # distillate/ddsketch/protobuf: Datadog's message, its own
                    # subpath so the sketch alone never bundles the codec
  minhash/          # MinHash: minhash.ts (frame type 11, one-permutation slots,
                    # densified on read, cached), lsh.ts for MinHashLSH, sizing.ts for
                    # minHashSizing, lshSizing and the k bounds both share
  riblt/            # RIBLT: encoder.ts, decoder.ts (peeling, local/remote), window.ts
                    # (typed-array min-heap of symbols on next index), mapping.ts (checksum,
                    # xoroshiro64** index sequence), frame.ts (frame type 12, columns)
  frame/            # distillate/frame: readFrameAt for walking a stream of frames
  index.ts          # root barrel (VERSION only)
```

Planned, not yet present: `counting/` (Counting Bloom).

Subpath exports mirror these directories (see [engineering.md](engineering.md)).

## Related

- [choosing a structure](https://distillate.akxp.net/guides/choosing-a-structure/), [hashing.md](hashing.md), [serialization](https://distillate.akxp.net/reference/serialization/)
