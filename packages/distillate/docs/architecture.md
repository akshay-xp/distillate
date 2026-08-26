# Architecture

Deep modules, one narrow interface. Every structure feels identical to use.

## Three families

Static and mutable filters have honestly different lifecycles, and sketches answer a different question entirely. Do not pretend everything is a Bloom filter (the mistake incumbents make).

- Mutable: `add` (and sometimes `delete`) after construction. Bloom, Blocked Bloom, Counting Bloom, Scalable Bloom, Cuckoo.
- Static: `build(keys)` once, then immutable and queried. Binary Fuse, XOR. Smaller and faster; can fail-and-retry on build.
- Sketches: `add` then ask an aggregate question, never a per-key one. HyperLogLog (cardinality); Count-Min (frequency), t-digest/KLL (quantiles), MinHash (similarity) are the same family, not yet shipped.

### Why a sketch is not a `Filter`

The split is structural, not taxonomic. `Filter` promises `has(key)` and `bitsPerKey`, and a sketch can honour neither.

A HyperLogLog does not store membership: it keeps `2^p` registers holding the longest run of leading zeros hashed to each, from which a cardinality is inferred. Nothing in there answers "did I see this key". And `bitsPerKey` has no denominator, because a sketch's size is fixed by `p` before it sees a single key. That fixed size is the entire point: 12 KiB counts a thousand distinct keys or a billion.

So sketches get their own narrow interface rather than a widened `Filter` with methods that throw. The union operation is shared in spirit but not in type: filters merge only at identical parameters, while sketches fold to the coarser precision.

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
```

Each structure also exposes `fromBytes(bytes: Uint8Array): Filter` (static method).

Introspection accessors sit alongside the narrow interface, not in it: Bloom exposes `m`/`k`/`seed`/`length`/`rate()`, Blocked exposes `length`/`rate()`. They read back build params and current fill (`rate()` is a fill-based FPR estimate); Fuse needs none of them since it is static and reports `size`.

## Sizing helpers (first-class)

`bloomSizing(n, epsilon)` returns the params for a target count and false-positive rate. Incumbents force manual computation; this is a core ergonomics win.

## Storage

- Backing: `Uint8Array` (bit array, serializable, `SharedArrayBuffer`-friendly) or `Uint32Array` for word ops.
- Bit ops unsigned: always `>>> 0`; `bit = arr[i >>> 3] & (1 << (i & 7))`.
- Bucket reduction: Lemire multiply-shift, not modulo.
- Large filters (> 2^32 bits): separate opt-in class using `Math.floor(i / 8)` index math instead of 32-bit shifts, sharded across typed arrays (single ArrayBuffer capped ~2 GiB in V8). Common small path stays in fast Number/typed-array land.

## Constraints (no compromise)

No top-level side effects. No decorators, no `reflect-metadata`, no dynamic `eval`. This is what keeps it edge-safe and tree-shakeable.

## Planned file layout

```
src/
  core/
    bytes.ts        # BytesLike normalization, UTF-8 encode
    hasher.ts       # Hasher interface, default murmur3-x64-128, KM double hashing
    bitset.ts       # typed-array bit storage + large-filter variant
    serialize.ts    # header read/write, CRC32, version dispatch
    sizing.ts       # bloomSizing(n, epsilon)
  bloom/            # classic + blocked
  counting/         # counting + scalable
  cuckoo/
  binary-fuse/      # fuse8 / fuse16 (+ xor optional)
  index.ts          # barrel
```

Subpath exports mirror these directories (see [engineering.md](engineering.md)).

## Related

- [choosing a structure](https://distillate.akxp.net/guides/choosing-a-structure/), [hashing.md](hashing.md), [serialization](https://distillate.akxp.net/reference/serialization/)
