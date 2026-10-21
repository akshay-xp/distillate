---
title: Serialization format
description: The versioned, self-describing DSTL binary format, covering byte layout, per-type params blocks, hash variant, and the rules a reader in any language must follow.
---

Versioned, self-describing, little-endian binary format. Spec'd here so Rust/Go readers can parse it, and checked: a Go reader written from this page alone (`packages/distillate/interop/golden_test.go`, CI job `interop (go)`) verifies every golden frame, including lane byte order and HLL register packing, without the JS code. Not decorator/reflect-metadata magic (that is what breaks incumbents on edge).

## Layout

```
Offset  Size  Field
0       4     Magic "DSTL" (0x44 53 54 4C)
4       1     Format version (u8)         # bump on incompatible layout change
5       1     Structure type (u8)         # 1=Bloom 2=BlockedBloom 3=Fuse8 4=Fuse16 5=HyperLogLog 6=ScalableBloom 7=Cuckoo 8=CountMin 9=TopK 10=DDSketch 11=MinHash 12=RIBLT 13=Theta 14=KLL
                                          # (15+ reserved: CountingBloom, ...)
6       1     Flags (u8)                  # bit0-3 hash variant, bit4-7 reserved (must be 0)
7       1     Reserved (u8)               # must be 0
8       4     Body length (u32)           # bytes of body, excluding header and CRC
12      4     Reserved (u32)              # must be 0; keeps the body 8-byte aligned
16      ...   Body: params block, padded to a multiple of 8 (fixed per type, see below)
...     ...   Payload: raw backing typed array, host byte order (see Principles)
end     4     CRC32 of all preceding bytes
```

Current `FORMAT_VERSION` is `5`. Readers reject any other version (`UnknownVersionError`).

The body length makes a frame self-describing: the layout permits a reader to validate, skip, or stream a frame of a structure type it does not implement, using the header alone. `fromBytes` accepts exactly one whole frame of its own type; to walk a buffer of several, use `readFrameAt` ([below](#reading-a-stream-of-frames)). It is checked against the bytes actually present _before_ the CRC, so a frame cut short in transit reports `TruncatedError` rather than the checksum failure truncation also implies. Readers additionally validate the body length against the declared params before allocating, which catches a frame whose header is internally consistent but whose params disagree with the payload size.

### Payload alignment

Every type's params block is padded to a multiple of 8, so **the payload always begins at a frame offset that is a multiple of 8**. A reader that holds a frame at an 8-byte aligned address can therefore map the payload as a typed slice (`&[u32]`, `&[u16]`) instead of copying it. The padding bytes are zero and a reader must reject a frame that sets them, for the same reason it rejects a reserved header bit: they are space a later version may spend.

The guarantee is **per frame, not across a stream**. A frame occupies `16 + bodyLength + 4` bytes, which is not itself a multiple of 8, so frames concatenated in a log do not each start aligned. A reader walking such a log gets the alignment guarantee only for frames it has positioned itself.

Padding is what makes the guarantee a rule rather than an accident. Through version 4 the payload offsets were 30, 28, 32, 32 and 22, and only held because of the lane widths that happened to sit there; HyperLogLog's sparse entries are `u32` at offset 22, which no language permits a typed view over. `writeFrame` now refuses a params block that would put a payload off an 8-byte boundary, so a new structure type cannot reintroduce it.

### Reading a stream of frames

`readFrameAt(bytes, offset)` from `distillate/frame` validates the one frame at `offset` in place (magic, version, length, CRC, reserved bits) without knowing its structure type, and returns its `type` and `byteLength`. Advance by `byteLength` to reach the next frame.

```ts
import { BloomFilter } from "distillate/bloom";
import { readFrameAt } from "distillate/frame";
import { HyperLogLog } from "distillate/hll";

const filter = BloomFilter.create(1000, 0.01);
filter.add("alice");
const sketch = new HyperLogLog({ p: 10 });
sketch.add("alice");

const a = filter.toBytes();
const b = sketch.toBytes();
const bytes = new Uint8Array(a.length + b.length);
bytes.set(a, 0);
bytes.set(b, a.length);

const types: number[] = [];
for (let offset = 0; offset < bytes.length;) {
  const frame = readFrameAt(bytes, offset);
  types.push(frame.type);
  offset += frame.byteLength;
}
types.join(", "); // "1, 5"

const first = readFrameAt(bytes, 0);
BloomFilter.fromBytes(bytes.subarray(0, first.byteLength)).has("alice"); // true
```

A frame cut short mid-stream throws `TruncatedError`. A frame of a type the reader does not implement still validates, and is skipped by its `byteLength`.

### Reserved bits

The header reserves 44 bits: flags bits 4-7, byte 7, and the `u32` at offset 12. All of them **must be 0**, and a reader that finds any of them set must reject the frame, not ignore it. `distillate` throws `ReservedBitsError`, naming which field was set.

Rejection is what keeps the space spendable. Only a newer writer sets a reserved bit, and a reader that ignored it would read that frame under the older meaning and return a wrong answer with no error, so every real extension would need a breaking version bump anyway. This is the same reasoning that made the version 3 hash change a version bump (see [hash variant](#hash-variant-flags-nibble)), applied to the reserved space. Zstd makes the same rule for its reserved frame-header bit. Protobuf instead skips unknown fields, but only because each field carries its own wire type and length; these bits carry no length, so skipping them is not safe.

The check runs after the CRC. A reserved bit flipped in transit therefore reports `ChecksumError`, and `ReservedBitsError` means the frame is intact and was written by a newer format.

### Versions 4 and 5 are hard breaks

Version 4 renamed the magic from `AMQF` (_Approximate Membership Query Filter_) to `DSTL`, because `distillate` serializes structures that are not membership filters. There is no dual-magic read path: a pre-v4 frame fails on magic with `BadMagicError`, not on version. Version 5 then padded every params block to align the payload, which moved every payload offset. A v4 frame keeps the `DSTL` magic and so fails on the version byte with `UnknownVersionError`. Re-serialize such data with the version you run.

### Params block per type (version 5)

Params offsets below are relative to the start of the body (frame offset 16).

Bloom (type 1), little-endian:

```
Offset  Size  Field
0       4     m: number of bits (u32)
4       2     k: number of hash probes (u16)
6       4     seed (u32)
10      4     n: expected key count (u32)
14      2     padding (0)
16      ...   payload: bit array, ceil(m / 8) bytes
```

Bit `i` of the array is bit `i & 7` of byte `i >>> 3`, counting from the least significant bit: it is set when `bytes[i >>> 3] & (1 << (i & 7))` is nonzero.

Blocked (type 2): `numBlocks (u32) | seed (u32) | n (u32) | 4 bytes padding`, then the lane words (`numBlocks * 32` bytes) at body offset 16: `numBlocks * 8` `u32` little-endian, block `b` being lanes `8b` to `8b + 7`, and bit `j` of a lane being `1 << j`. Fuse (types 3 and 4): `seed (u32) | seg (u32) | segCountLen (u32) | size (u32)`, which fills 16 exactly, then the fingerprint array: `segCountLen + 2 * seg` fingerprints, `u8` for Fuse8 and `u16` little-endian for Fuse16. `size` is the number of distinct keys. An empty filter (`size` 0) has **no** fingerprints, whatever the geometry says; it still carries a valid geometry (the build writes `seg` 1, `segCountLen` 1) and answers false for every key without computing positions.

HyperLogLog (type 5), little-endian:

```
Offset  Size  Field
0       1     p: precision, 4..18 (u8)
1       1     encoding: 0 = dense, 1 = sparse (u8)
2       4     seed (u32)
6       2     padding (0)
8       ...   payload: dense registers or sparse entries, see below
```

Dense payload: the register array. `2 ** p` registers of 6 bits each, packed LSB-first into `2 ** p * 6 / 8` bytes with no padding (`6 * 2 ** p` divides by 8 for every `p >= 2`). Register `i` spans bits `[6i, 6i + 6)`, so it straddles at most two bytes: with `bit = 6 * i` and `at = bit >>> 3`, with `shift = bit & 7` its value is `(bytes[at] >>> shift) & 0x3f` when `shift <= 2`, since the register then fits inside byte `at`, and `((bytes[at] >>> shift) | (bytes[at + 1] << (8 - shift))) & 0x3f` otherwise. Read only the bytes the register spans: the last register always has `shift` 2 and ends on the final byte, so a formula that loads `bytes[at + 1]` unconditionally reads one byte past the payload. Each register holds the largest rho seen for it, rho being the 1-based position of the first set bit in the `64 - p` hash bits below the index; six bits suffice because rho never exceeds `65 - p`.

Sparse payload: `n` entries of 4 bytes each, `u32` little-endian, one per distinct index, sorted ascending. An entry is 31 bits wide, `index << 6 | rho`: the index in the top 25 bits, rho in the low 6 bits, and bit 31 always clear. The index is taken at a fixed sparse precision of 25 whatever `p` is, so a small sketch counts distinct indices rather than estimating; the rho beside it is the _dense_ rho for this frame's `p`, not one measured at 25. A reader materialises the registers with `register = index >>> (25 - p)`, keeping the largest rho that lands on each. Either encoding can appear for any `p`: a sketch starts sparse and rewrites itself dense once the entries stop being cheaper than the register array.

Scalable Bloom (type 6), little-endian. A chain of Bloom stages sharing one hash, for a key count not known up front:

```
Offset  Size             Field
0       4                n: the first stage's capacity (u32)
4       4                seed (u32)
8       8                epsilon: false-positive target for the whole chain (f64)
16      8                growth: capacity multiplier from one stage to the next (f64)
24      8                tightening: target multiplier from one stage to the next (f64)
32      4                stageCount (u32), at least 1
36      4                padding (0)
40      16 * stageCount  stage table, one 16-byte entry per stage:
                           +0   4  m: bits in the stage (u32)
                           +4   2  k: probes per key (u16)
                           +6   2  padding (0)
                           +8   4  capacity: keys the stage holds before the next opens (u32)
                           +12  4  count: keys counted into the stage (u32), at most capacity
...                      each stage's bits, in table order: ceil(m / 8) bytes in the Bloom
                         bit order, then zero padding up to a multiple of 8
```

The params end at 40 and each entry is 16 bytes, so the table starts at frame offset 56 and every stage's bits start at a multiple of 8. The body is exactly `40 + 16 * stageCount` plus each stage's padded bit length; a reader rejects any other length, a `stageCount` of 0, an `m`, `k` or `capacity` of 0, a `count` above its `capacity`, and nonzero padding.

A key is present if any stage holds it, that is, if all `k` of that stage's probes are set. A writer adds a key in three steps, and a reader that rebuilds a frame from its keys must follow them in order:

1. If any stage already holds the key, nothing changes. Only a key not already held is counted, so duplicates never use up a stage's capacity.
2. Otherwise, if the newest stage's `count` has reached its `capacity`, the next stage opens.
3. The key's probes are set in the newest stage, and that stage's `count` goes up by one.

Stage geometry is stored rather than re-derived, so a reader needs no floating-point sizing and takes each stage's `m`, `k` and `capacity` from the table. For writers, informatively: stage `i` has capacity `ceil(n * growth ** i)` and false-positive target `epsilon * (1 - tightening) * tightening ** i`, sized as Bloom is, `m = ceil(-capacity * ln(target) / ln(2) ** 2)` and `k = max(1, round(m / capacity * ln 2))`. The targets form a geometric series summing to at most `epsilon`, which is the chain's bound. A writer refuses to open a stage whose `m` would exceed `2^32 - 1`.

Cuckoo (type 7), little-endian. Fingerprints in buckets of four slots, each key in one of two candidate buckets, with delete:

```
Offset  Size  Field
0       4     n: expected key count (u32)
4       4     seed (u32)
8       8     epsilon: false-positive target at n keys (f64)
16      4     f: fingerprint width in bits, 4..32 (u32)
20      4     buckets: number of 4-slot buckets (u32)
24      4     count: fingerprints stored (u32)
28      4     padding (0)
32      ...   slot words: ceil(4 * f * buckets / 32) u32 little-endian, then zero
              padding up to a multiple of 8
```

The params end at 32, so the slot words start at frame offset 48, a multiple of 8. The table has `4 * buckets` slots of `f` bits each, `m = 4 * f * buckets` bits in all. Slot `j = bucket * 4 + s` (slot `s` of its bucket) occupies stream bits `j * f` to `j * f + f - 1`, low bit first, and stream bit `x` is bit `x & 31` of word `x >>> 5`, so a slot can straddle two words. A slot value of 0 means empty. A reader builds the table from the stored `f` and `buckets`, which need not match what the current sizing gives for `n` and `epsilon`, and must not re-derive them: sizing may be tuned, and frames written before that stay valid. It rejects `f` outside 4..32, `buckets` of 0, and an `m` past `2^32 - 1`. The body is exactly `32` plus the padded word length; a reader rejects any other length, nonzero padding (in the params, in the bits of the last word past `m`, and in the trailing bytes), and a `count` that differs from the number of nonzero slots.

A key's fingerprint and buckets come from its hash words (see [hash variant](#hash-variant-flags-nibble)):

- `fp = w1 >>> (32 - f)`, and 1 if that is 0, so a stored fingerprint is never the empty marker.
- `i1 = reduce(w0, buckets)`, Lemire multiply-shift as for Bloom.
- `i2 = alt(i1, fp)`, where `alt(i, fp) = ((mix(fp) mod buckets) + buckets - i) mod buckets` and `mix(fp) = fp * 0x5bd1e995 mod 2^32`. Applying `alt` twice returns `i`, so a stored fingerprint can move between its two buckets without its key.

A key is present if either bucket holds a slot equal to `fp`. A writer adds a key as follows, and a reader that rebuilds a frame from its keys must follow the same steps:

1. Put `fp` in the first empty slot (slot 0 to 3) of `i1`, else of `i2`.
2. Otherwise both buckets are full, so evict. Start at `i1` if `w2 & 1` is 0, else at `i2`. Seed a xorshift32 state `x = w3 | 1`. Each kick advances `x ^= x << 13; x ^= x >>> 17; x ^= x << 5` (all mod `2^32`), swaps the carried fingerprint with slot `x & 3` of the current bucket, moves to `alt(bucket, victim)` for the fingerprint it now carries, and stops if that bucket has an empty slot, which takes it.
3. After 500 kicks without finding room, the writer undoes every swap in reverse and refuses the key. A frame never records a failed add.

Every add stores a fingerprint, including for a key already present, and `count` goes up by one. Delete removes one copy: the first slot equal to `fp` among slots 0 to 3 of `i1`, then of `i2` (skipped when `i2` equals `i1`), is set to 0, and `count` goes down by one. A delete for a key that was never added can clear another key's matching fingerprint; the format cannot tell the two apart.

Geometry is stored rather than re-derived, so a reader needs no floating-point sizing and takes `f` and `buckets` from the params. For writers, informatively: `f = max(4, ceil(log2(8 / epsilon)))`, refused above 32, and `buckets = ceil(n / 3.8) + ceil(sqrt(n))`, 95% load plus slack that lets small tables take `n` keys. A writer refuses a table whose `m` would exceed `2^32 - 1`.

Count-Min (type 8), little-endian. A grid of counters, one per row per key, whose smallest is the estimate:

```
Offset  Size  Field
0       4     width: counters per row (u32)
4       4     depth: number of rows (u32)
8       4     seed (u32)
12      4     padding (0)
16      ...   counters: width * depth u32 little-endian, row major
```

The params end at 16, so the counters start at frame offset 32, a multiple of 8. Counter `r * width + c` is column `c` of row `r`. The body is exactly `16 + 4 * width * depth`; a reader rejects any other length, and rejects a `width` or `depth` of 0 and nonzero params padding.

**No total is stored.** Every add increments one counter in each row, so under this format's update rule every row sums to the total recorded, and a reader derives it by summing any one row. That makes the absence of the field an integrity check rather than a saving: a reader must confirm every row sums to the same value and reject the frame when they disagree, and must reject a sum past `2^53 - 1`, which counting could not have reached. Storing the field instead would leave a forged or corrupted counter undetectable.

This rule is what pins type 8 to plain increment. A conservative-update sketch, which raises only the counters at the current minimum, does not hold the row-sum invariant and would need its own type rather than this one.

A reader builds the grid from the stored `width` and `depth`, which need not match what the current sizing gives for `epsilon` and `delta`, and must not re-derive them: sizing may be tuned, and frames written before that stay valid.

A key's counters come from its hash words (see [hash variant](#hash-variant-flags-nibble)): row `r` uses the Bloom probe `g_r = (w0 + r*w1 + r*r) mod 2^32`, reduced into `[0, width)`, offset by `r * width`. `count(key)` is the smallest of the `depth` counters so addressed, and is never below the key's true count. Combining two grids of identical `width`, `depth` and `seed` adds their counters elementwise, giving the grid one sketch would hold had it seen both streams.

Geometry is stored rather than re-derived, so a reader needs no floating-point sizing. For writers, informatively: `width = ceil(e / epsilon)` and `depth = ceil(ln(1 / delta))`, so an estimate is at most `epsilon` times the total above the truth with probability at least `1 - delta`. A writer refuses a grid whose `width * depth` would exceed `2^32 - 1`, and refuses an add that would carry a counter past `2^32 - 1` rather than wrapping.

Top-K (type 9), little-endian. The keys seen most often, each with a stored count, in a map purged whenever it passes its load limit:

```
Offset    Size          Field
0         4             capacity: slots in the map, a power of two in [4, 2^24] (u32)
4         4             entries: keys held, at most floor(0.75 * capacity) (u32)
8         8             offset: everything the purges have subtracted (f64), an integer
16        8             total: every count ever added (f64), an integer
24        8             padding (0)
32        4 * entries   counts: each held key's stored count (u32), at least 1
32 + 4e   4 * entries   lengths: each held key's length in bytes (u32)
32 + 8e   sum(lengths)  keys: the key bytes, concatenated with no separator or padding
```

Here `e` is `entries`. The params end at 32, so the counts start at frame offset 48, a multiple of 8, and the lengths at a multiple of 4. Entry `i` is `counts[i]`, `lengths[i]`, and the `lengths[i]` bytes that follow the keys of entries `0` to `i - 1`. This is the first type whose body length does not follow from its params: a reader bounds the table by `entries`, sums the lengths, and requires the body to be exactly `32 + 8 * entries + sum(lengths)`. It rejects a body longer than that as firmly as a shorter one, since bytes no entry accounts for were not written by this format.

**Entries are in canonical order**: `count` descending, then key bytes ascending, comparing bytes as unsigned values and putting a key before any longer key it is a prefix of, so the empty key sorts first among equal counts. The order depends only on which keys are held with which counts, never on the order they arrived or where the in-memory map placed them, which is why two sketches holding the same entries write the same bytes. A reader requires each entry to follow its predecessor strictly in this order.

A reader rejects:

- a `capacity` that is not a power of two, or is outside `[4, 2^24]`;
- an `entries` above `floor(0.75 * capacity)`;
- a body length other than `32 + 8 * entries + sum(lengths)`, in either direction;
- a stored count of 0;
- entries not in strict canonical order, and a key that appears twice;
- an `offset` or `total` that is not an integer in `[0, 2^53 - 1]`;
- `sum(counts) + W * offset` above `total`, where `W = (floor(0.75 * capacity) + 2) >> 1`. Every purge removes at least `W` times its median while adding the median to `offset`, and combining frames adds both sides, so counting cannot produce such a frame. It is the bound `offset <= epsilon * total` itself;
- nonzero params padding.

For a held key, the estimate is `count + offset`, never below its true count, and `count` alone is a lower bound, never above it. A key not held estimates 0, and its true count is at most `offset`: nothing heavier than the offset can have been dropped.

A writer adds `n` occurrences of a key (`n` at least 1) as follows, and a reader that rebuilds a frame from its keys must follow the same steps:

1. The key's stored count goes up by `n`, entering at `n` if it was not held, and `total` goes up by `n`.
2. If `entries` is now above `floor(0.75 * capacity)`, purge: sort the stored counts ascending and take `median = sorted[entries >> 1]`, the upper median. Subtract it from every stored count, drop every key whose count reaches 0 or below, and add it to `offset`.

The upper median guarantees at least `(entries >> 1) + 1` keys go, so one purge always makes room. A writer refuses an add that would carry a stored count past `2^32 - 1` or `total` past `2^53 - 1`.

Combining two frames of identical `capacity`, informatively: sum each key's stored counts, and the offsets and totals, then purge as above while `entries` is above the load limit. Unlike Count-Min, this is not the frame one sketch fed both streams would hold, since a single sketch purges as it goes; both hold the guarantee.

Keys are stored verbatim, so unlike every other type this frame contains user input as written. Geometry is stored rather than re-derived. For writers, informatively: `capacity` is the smallest power of two with `1 / ((floor(0.75 * capacity) + 2) >> 1) <= epsilon`, that denominator being the fewest keys a purge takes its full median from, which is what bounds `offset` by `epsilon * total`.

DDSketch (type 10), little-endian. A quantile sketch: values, not keys, binned by a logarithmic mapping so every bin spans the same relative width. Nothing is hashed.

```
Offset    Size      Field
0         1         mapping: 0 = log, 1 = linear, 2 = quadratic, 3 = cubic (u8), Datadog's Interpolation values
1         1         store: 0 = dense, 1 = collapsing-lowest, 2 = collapsing-highest, 3 = sparse (u8)
2         2         reserved (0)
4         4         maxBins: bins kept per sign (u32), at least 1 for a collapsing store and 0 otherwise
8         8         gamma: the base each bin grows by (f64), above 1
16        8         indexOffset: added to every index (f64), finite
24        8         relativeAccuracy: the bound the sketch was built for (f64), in (0, 1)
32        8         sum: every value added, weighted by its count (f64)
40        8         min: the smallest value added (f64), NaN when empty
48        8         max: the largest value added (f64), NaN when empty
56        8         zeroCount: values counted as zero (f64), finite and at least 0
```

The params end at 64. Then come two blocks, the positive values' bins and then the negative values' bins by magnitude, each laid out as:

```
Offset    Size      Field
0         1         layout: bit 0 = contiguous run, bit 1 = f64 counts, bits 2-7 reserved (0)
1         3         reserved (0)
4         4         n: slots in the run, or bins as pairs (u32)
8         4         start: the run's first index (i32), 0 for pairs
12        4         reserved (0)
16        w * n     counts: u32 (w = 4) or f64 (w = 8)
16 + wn   4 * n     indices: each bin's index (i32), pairs only
```

A block is padded with zeros to a multiple of 8 bytes, so the next block's header and every `f64` count stay aligned. As a run, count `i` is the bin at index `start + i`, and a slot holding 0 is an empty bin; as pairs, count `i` is the bin at `indices[i]`, ascending.

A writer chooses each block's form from its bins alone, so the bytes depend on the bins and not on which store held them or the order values arrived. Counts are u32 when every count in the sign is a whole number up to `2^32 - 1`, and f64 otherwise. The bins are a run from the first to the last when that takes no more bytes than pairs (`span * w <= bins * (w + 4)`), and pairs otherwise. A sign with no bins is pairs with `n` 0. Latency-like streams fill their range, so they come out as runs of u32 counts: four bytes a bin.

A positive value `v` lands in bin `x = log(v) * multiplier + indexOffset` under the log mapping, where `multiplier = 1 / ln(gamma)`, taking `x` truncated toward zero and then one lower when `x` is negative, as sketches-go computes it (this differs from `floor` only at an exact negative integer); the interpolated mappings replace `log` with an approximation computed from the float's exponent and significand, as sketches-go and sketches-java define them. A linear mapping with `indexOffset` 0 and `gamma` exactly `2^(1 / 2^k)` is sketches-java's bitwise mapping, and a reader must bin it as that mapping does: a value's bin is its unbiased binary exponent times `2^k` plus the top `k` bits of its significand, read as one integer. The general linear formula reaches the same bins mathematically, but its float rounding moves some values on a boundary one bin over. Values whose magnitude is at most the mapping's smallest indexable value count in `zeroCount`. A bin reads back as its lower bound times `1 + a`, where `a` is the accuracy `gamma` implies, which keeps it within `a` of every value in the bin.

There is no count field. The count is `zeroCount` plus every bin's count, derived on read: a running total of fractional weights rounds differently from the bins summed in index order, so a stored count could disagree with its own bins. `sum` is stored because it cannot be derived, and since it is a float accumulation it depends on the order values arrived; the bins never do. A writer records `-0` as `0`, so `min` and `max` do not depend on which zero came first. Indexable values can sum past the largest double, so `sum` may be `+Infinity`, `-Infinity`, or NaN once both signs overflow; a writer writes that NaN as `0x7FF8000000000000` and no other pattern.

A reader rejects:

- a mapping or store code above 3, or nonzero reserved bytes;
- a `maxBins` of 0 on a collapsing store, or above 0 on any other;
- a body length other than 64 plus the two blocks, or a block that runs past the body;
- set reserved layout bits or bytes, nonzero padding, or pairs with a nonzero `start`;
- a block whose form or count width is not the one a writer chooses for its bins, since that would be a second encoding of the same sketch;
- a `gamma` that is not finite and above 1, a non-finite or `-0` `indexOffset`, or a `relativeAccuracy` outside `(0, 1)`;
- a bin count that is not finite and positive (a run's interior slots may be 0, its first and last may not), indices out of strictly ascending order within a sign, or an index outside the mapping's indexable range;
- a collapsing store's bins spanning more than `maxBins` indices within a sign;
- a negative or non-finite `zeroCount`;
- an empty frame whose `min` and `max` are not NaN or whose `sum` is not 0, and a non-empty frame whose `min` or `max` is not finite, whose `min` is above its `max`, or whose extreme bins lie outside `[min, max]` by more than the mapping's accuracy;
- a `sum` of `+Infinity` unless the positive bins could overflow, that is, every positive bin's count times its upper edge, summed and scaled by `1 + relativeAccuracy`, reaches the largest double; `-Infinity` unless the negative bins could, by the same test; NaN unless both could, or in any bit pattern other than `0x7FF8000000000000`.

Combining two frames, informatively: their mappings must agree on kind exactly and on `gamma` and `indexOffset` within 1e-12 relative, sketches-go's tolerance; then add every bin's count into one store, which folds a collapsing store exactly as one stream would have, and add `zeroCount` and `sum`, keeping the smaller `min` and larger `max`. This is the frame one sketch fed both streams would hold, `sum` aside.

MinHash (type 11), little-endian. A similarity sketch: `k` slots, each holding the smallest hash value any key sent to it, from which two sketches' Jaccard similarity is estimated.

```
Offset    Size      Field
0         4         seed: hash seed (u32)
4         2         k: slots (u16), 2 to 4096
6         2         reserved (0)
8         4 * k     slots: each slot's minimum (u32), 0xffffffff where no key landed
```

The params end at 8, padded so the slots sit 4-byte aligned at frame offset 24. A key is hashed once (see [hash variant](#hash-variant-flags-nibble)) and touches one slot, one-permutation hashing: slot `reduce(w0, k)`, the high 32 bits of `w0 * k`, takes value `min(w1, 0xfffffffe)` when that is below what it holds. The clamp keeps `0xffffffff` free to mean empty.

The slots are stored raw. A sketch of fewer keys than `k` leaves slots empty, and a reader estimating similarity fills each from a filled slot by optimal densification before comparing; that densified signature is never stored, so a decoded sketch still merges exactly. Combining two frames of identical `k` and `seed`: take the slot-wise min, which is the frame one sketch fed both key sets would hold.

A reader rejects:

- a body shorter than the 8-byte params block, or nonzero reserved bytes;
- a `k` outside 2 to 4096;
- a body length other than `8 + 4 * k`.

Every slot value is otherwise valid: a real minimum is never `0xffffffff`, so a slot either holds one or is empty. Which slots are filled is derived on read; the frame has no count of them.

RIBLT (type 12), little-endian. A batch of coded symbols from a rateless set reconciliation stream: `count` consecutive symbols starting at index `start`. A frame is not a structure but a slice of an endless stream, so a peer receives a sequence of them, in order, until it decodes.

```
Offset             Size       Field
0                  4          seed: hash seed (u32)
4                  4          start: index of the first symbol in the stream (u32)
8                  4          count: symbols in this frame (u32)
12                 4          reserved (0)
16                 8 * count  sums: each symbol's XOR of key symbols (u64, low word first)
16 + 8 * count     8 * count  checksums: each symbol's XOR of key checksums (u64, low word first)
16 + 16 * count    4 * count  counts: keys folded into each symbol (i32)
```

The params end at 16, so the first column sits 8-byte aligned at frame offset 32. Each field is stored as its own column rather than as 20-byte records, so every `u64` lane stays 8-byte aligned and a reader can map each column as a typed slice. A key's symbol is the 64-bit `w1:w0` of its hash (see [hash variant](#hash-variant-flags-nibble)); its checksum is a function of the symbol alone, so a decoder can verify a symbol it only ever received. A sender's symbols carry positive counts; a receiver subtracts its own keys, so the cells it peels hold `+1` for a key only the sender has and `-1` for one only it has.

A reader rejects:

- a body shorter than the 16-byte params block, or nonzero reserved bytes;
- a body length other than `16 + 20 * count`.

A decoder also refuses a frame whose `seed` differs from its own, or whose `start` is not the next index it expects; both are faults in how frames reached it, not in the bytes.

Theta (type 13), little-endian. A distinct-count sketch that also intersects and subtracts: every key hash below `theta`, at most `k` of them, from which the count is `count / (theta / 2^53)`.

```
Offset        Size         Field
0             4            seed: hash seed (u32)
4             4            k: hashes kept once estimating (u32), a power of two from 16 to 2^26
8             8            theta: sampling bound (u64), 1 to 2^53; 2^53 means every hash was kept
16            4            count: hashes stored (u32), at most k
20            4            reserved (0)
24            8 * count    hashes: the stored hashes (u64), strictly ascending, each in [1, theta)
```

The params end at 20, padded so the hashes sit 8-byte aligned at frame offset 40. A key is hashed once (see [hash variant](#hash-variant-flags-nibble)) to `(w1 >>> 11) * 2^32 + w0`, an integer below `2^53`.

Only the canonical sample is stored: the `k` smallest hashes seen, with `theta` the next one, or every hash and `theta = 2^53` while there are no more than `k`. A sketch in memory may hold more between rebuilds, but which it holds depends on the order keys arrived in; the canonical sample does not, so two sketches of the same keys and params write identical bytes.

Combining two frames of identical `seed`, informatively: take `theta` as the smaller of the two and `k` as the smaller. A union keeps the hashes in either below `theta`, and if more than `k` remain, keeps the `k` smallest and lowers `theta` to the next; an intersection keeps the hashes in both below `theta`; a difference keeps the first frame's hashes below `theta` that the second lacks. Taking the smaller `k` is what makes any grouping of unions give the same frame.

A reader rejects:

- a body shorter than the 24-byte params block, or nonzero reserved bytes;
- a `k` that is not a power of two from 16 to 2^26;
- a body length other than `24 + 8 * count`;
- a `theta` of 0 or above `2^53`, or a `count` above `k`;
- hashes that are not strictly ascending, or one that is 0 or not below `theta`.

KLL (type 14), little-endian. A quantile sketch with a bound on rank error: items in levels, where an item at level `h` stands for `2^h` stream values.

```
Offset           Size          Field
0                1             item type: 0 = f64; anything else is rejected
1                1             flags: bit 0 seeded, bits 1-7 reserved (0)
2                2             k: u16, 8 to 65535
4                4             state: generator state (u32), 0 while unseeded
8                8             n: stream count (u64), at most 2^53 - 1
16               8             min: smallest value (f64), NaN when empty
24               8             max: largest value (f64), NaN when empty
32               4             levels: L (u32), 1 to 64
36               4 * L         sizes: items per level (u32), level 0 first
36 + 4L          to align8     padding: zero, so the items sit 8-byte aligned
align8(36 + 4L)  8 * retained  items: f64, level 0 first, retained = Σ sizes
```

`align8(x)` rounds `x` up to a multiple of 8. Level 0 is unsorted: each value is written in front of the last, so it reads newest first, and a compaction leaves its odd item out at the end. Every level above it is ascending. Every compaction halves a level and promotes the survivors one level up at twice the weight, so `n = Σ size_h · 2^h` holds exactly, and a reader checks it.

The generator state is a splitmix32 state: a compaction steps it by `0x9e3779b9` mod `2^32` and keeps the odd-offset half when the top bit of murmur3's `fmix32` of the new state is set. It is carried so a decoded sketch flips the same coins the original would have, and a seeded sketch fed the same stream writes the same bytes. An unseeded sketch draws its seed at its first compaction and is flagged seeded from then on.

Combining two frames, informatively: the result takes the smaller `k`; each level is the two inputs' levels merged, then the lowest full level is compacted until the items fit. If both inputs are seeded, the result's state is `fmix32(a ^ fmix32(b))`, where `a` is the state of the sketch `union` is called on, so it replays neither input's coins; otherwise the result is unseeded.

A reader rejects:

- an item type other than 0, a reserved flag bit, or an unseeded frame with a nonzero state;
- `L` outside 1 to 64, a body length other than `align8(36 + 4L) + 8 * retained`, or nonzero padding;
- a `k` outside 8 to 65535, or more items than the level capacities at that `k` allow;
- an `n` that is not a safe integer or disagrees with `Σ size_h · 2^h`;
- a `min` above `max`, or an empty frame whose `min` and `max` are not both NaN;
- an item that is NaN or outside `[min, max]`, or a level above 0 out of ascending order.

### Hash variant (flags nibble)

Bits 0-3 of the flags byte name the complete scheme that turns a key into stored bits: the hash **and the index mapping** from its output to positions, not the hash alone. A change to any component takes a new variant, even when the hash itself is unchanged, because a reader that recognises the old variant would otherwise read every stored frame at the wrong positions with no error. Version 5 uses one scheme for every structure:

- `0` = murmur3_x86_128 (Bloom, Blocked, Fuse, HyperLogLog, Scalable, Cuckoo, Count-Min, Top-K, DDSketch, MinHash, RIBLT, Theta, KLL) with the index mapping below. Top-K, DDSketch and KLL write and require `0`, though no hash reaches their frames

Variant `0` covers:

- **Shared:** a string key is hashed as its UTF-8 bytes, a byte key as its bytes unchanged. A JS string is UTF-16 and can hold a lone surrogate, which has no UTF-8 form; it encodes as U+FFFD (`EF BF BD`), as `TextEncoder` does, so a reader in another language must apply the same replacement before hashing; murmur3_x86_128 runs with the frame's seed (Fuse hashes with seed 0) and yields four `u32` output words `w0` to `w3`.
- **Bloom:** `a = w0`, `b = w1`; probe `g_i = (a + i*b + i*i) mod 2^32` for `i = 0..k-1`; each reduced into `[0, m)` by Lemire multiply-shift, the high 32 bits of `g_i * m`.
- **Blocked:** block `= (w0 * numBlocks) >>> 32`; lane `i` of that block sets bit `(w1 * SALT[i] mod 2^32) >>> 27`, over the eight Parquet/Impala split-block salts `0x47b6137b`, `0x44974d91`, `0x8824ad5b`, `0xa2b7289d`, `0x705495c7`, `0x2df1424b`, `0x9efc4947`, `0x5c6bfb31`.
- **Fuse:** the 64-bit key hash `w1:w0` (`w1` high), plus the params `seed` (the attempt seed the build settled on) mod `2^64`, finalised by MurmurHash3's `fmix64` into `mix`; `h0 = (mix * segCountLen) >>> 64`, `h1 = (h0 + seg) ^ ((mix >>> 18) & segMask)`, `h2 = (h0 + 2*seg) ^ (mix_lo & segMask)`, where `segMask = seg - 1`; fingerprint `(mix_lo ^ mix_hi) & mask`, with `mask` `0xff` for Fuse8 and `0xffff` for Fuse16. A key is present when `fp[h0] ^ fp[h1] ^ fp[h2]` equals its fingerprint. Fuse16 fingerprints are `u16` little-endian.
- **HyperLogLog:** register `=` the top `p` bits of `w0`; rho `=` leading zeros + 1 over the remaining `64 - p` bits of `w0:w1`; a sparse entry's index is the top 25 bits of `w0`.
- **Scalable:** a key is hashed once with the frame's seed, and every stage applies the Bloom mapping above to that one hash with its own `m` and `k`.
- **Cuckoo:** fingerprint `fp = (w1 >>> (32 - f))`, or 1 when that is 0; bucket `i1 = reduce(w0, buckets)`; the other bucket `(fp * 0x5bd1e995 mod 2^32 mod buckets + buckets - i1) mod buckets`; an eviction walk starts from bit 0 of `w2` and draws its victim slots from a xorshift32 seeded with `w3 | 1`. The full rules are in the type 7 section above.
- **Count-Min:** `a = w0`, `b = w1`, exactly as Bloom; row `r` of `depth` takes probe `g_r = (a + r*b + r*r) mod 2^32` reduced into `[0, width)` by Lemire multiply-shift, addressing counter `r * width + g_r`.
- **Top-K:** no hash. The frame stores entries in canonical order, so no stored byte depends on where a key sat in memory, and a reader needs no hash to read or rebuild a frame. In memory, `distillate` places a key at `HalfSipHash-1-3(key) & (capacity - 1)` under 64 random bits each sketch draws for itself, probing linearly on a collision, so crafted keys cannot be made to share a slot. A reader in another language may place keys however it likes.

- **DDSketch:** no hash. It records values, not keys, and the mapping that bins them is named by the frame's own `mapping` byte and `gamma`, so a change to it is a new mapping code rather than a new variant.
- **MinHash:** slot `reduce(w0, k)` by Lemire multiply-shift; value `w1`, clamped to `0xfffffffe`. Densification probes slot `i`'s borrow sequence as `reduce(fmix32((i * 0x9e3779b1) ^ (attempt * 0x85ebca6b) ^ seed), k)` for `attempt = 1, 2, ...`, each product mod `2^32`; it is computed on read and never stored, but two readers must agree on it to agree on an estimate.
- **RIBLT:** a key's symbol is `w1:w0` (`w1` high). Its checksum is MurmurHash3's `fmix64` of the symbol XOR `0x9e3779b97f4a7c15`, a function of the symbol alone. The symbol reaches index 0 and then each next index `last + ceil((last + 1.5) * (1 / sqrt(u) - 1))`, where `u = (x + 0.5) / 2^32` and `x` is the next output of xoroshiro64** seeded with the checksum's low and high words. Two peers must agree on all of it, or no prefix of the stream decodes.
- **Theta:** a key's hash is `(w1 >>> 11) * 2^32 + w0`, the top 21 bits of `w1` above `w0`: an integer below `2^53`, so it and theta compare exactly as doubles. A hash of 0 is dropped. Which slot of its table a sketch keeps a hash in is not stored.
- **KLL:** no hash. It records values, not keys, and keeps them in sorted order, so no stored byte depends on a hash.

This is the case Guava hit: `MURMUR128_MITZ_32` and `MURMUR128_MITZ_64` use the same hash and differ only in how its 128 bits map to indices, yet the change still needed a new `Strategy` ordinal because the stored bits differ. Guava's ordinal covers the whole strategy, and this nibble does too.

All thirteen structures write variant `0` and reject any other variant on read with `UnknownHashVariantError`. Version 3 unified the hash: at version 2 Bloom/Blocked used murmur3_x86_32 and Fuse used MurmurHash3_x64_128, which is no longer accepted. Version 4 changed only the frame header and version 5 only the params padding; neither touched the hash.

That version 3 bump (rather than a flags-only change) was deliberate: the version-2 Fuse reader had no variant check and would silently misread a version-3 frame, so bumping the version made it reject on the version byte instead.

Forward-compat caveat: the version and variant checks protect a newer reader from an older frame (it refuses rather than misreads). An older reader that predates a check would misread a newer frame, so a consumer must be at least as new as the producer.

## API

Every structure exposes the same pair. `toBytes` copies the backing store
verbatim into the payload; the static `fromBytes` validates and reconstructs.

```ts
import { BloomFilter } from "distillate/bloom";

const filter = BloomFilter.create(1000, 0.01);
filter.add("alice");

const frame: Uint8Array = filter.toBytes();
const restored: BloomFilter = BloomFilter.fromBytes(frame);
```

Plus a JSON view (`toJSON` / `fromJSON`) that base64-encodes the same frame,
for transport and debugging, not as a second persistence format.

## Principles

- Header and params multi-byte integers are written little-endian via `DataView`, `littleEndian: true` explicit, so they parse identically on any host regardless of platform endianness.
- 64-bit fields via `getBigUint64`/`setBigUint64`.
- Payload is the raw backing typed array copied verbatim, so its multi-byte lanes (blocked's `Uint32Array` lane words, fuse16's `Uint16Array` fingerprints) land in host byte order, not a forced little-endian. Every supported JS runtime is little-endian, so on-disk frames are interoperable in practice, and the Go interop check fails if they are ever not; a hypothetical big-endian host would need a read-time byte-swap, which is not currently implemented. Bloom bit arrays and fuse8 fingerprints are `Uint8Array`, so they are endian-neutral. A same-params Rust/Go reader reconstructs by pointing at these bytes (how FastFilter serializes).
- Serialize mathematical params, not JS object internals. That is what makes cross-language real.
- Pin the hash variant in flags (see [hashing](/internals/hashing/)).
- Magic byte rejects foreign/corrupt input early; version byte lets readers refuse unknown formats instead of misparsing; CRC32 detects corruption.
- The header is self-describing: magic, version, type, and body length are readable without knowing the structure, so a generic reader can frame every record in a stream and skip the types it does not implement.

## Input handling

Accept `Uint8Array` or `ArrayBuffer`. Respect `byteOffset`/`byteLength`: build the `DataView` from `(buf.buffer, buf.byteOffset, buf.byteLength)`. Classic bug source.

## Stability

Golden fixtures pin the exact byte layout, which round-trip tests miss (`toBytes`/`fromBytes` drift together and stay mutually consistent). [`tests/fixtures/golden.json`](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/tests/fixtures/golden.json) holds a base64 `frame` per structure (one current-version frame per type, plus a stale-version frame), rebuilt from committed keys. `tests/core/golden.test.ts` asserts each current frame parses, contains its keys, re-serializes to the same bytes, and matches a fresh build from the recipe (so a layout change fails the fresh-build check); the stale-version frame must throw `UnknownVersionError`. That fixture is a current frame with its version byte overwritten, so it keeps the `DSTL` magic and reaches the version check; a genuine pre-v4 frame carries `AMQF` and is rejected on magic first, which each structure's own suite covers directly. Fixtures are committed and never regenerated in CI; on an intentional format bump, `pnpm golden:gen` (`scripts/gen-golden.ts`) refreshes them, and its output is byte-identical to the committed prettier format. What may change without a format version bump at all is set out in [the stability contract](/reference/versioning/#format-stability-contract).

Malformed-input fuzzing: bad magic, unknown version, wrong type, truncation, declared-length mismatch, bit-flip, CRC mismatch each throw a typed error, never crash or read out of bounds.

The format spec is published as a standalone doc for other-language implementers.
