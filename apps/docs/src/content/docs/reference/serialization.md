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
5       1     Structure type (u8)         # 1=Bloom 2=BlockedBloom 3=Fuse8 4=Fuse16 5=HyperLogLog 6=ScalableBloom 7=Cuckoo
                                          # (8+ reserved: CountingBloom, ...)
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

The params end at 32, so the slot words start at frame offset 48, a multiple of 8. The table has `4 * buckets` slots of `f` bits each, `m = 4 * f * buckets` bits in all. Slot `j = bucket * 4 + s` (slot `s` of its bucket) occupies stream bits `j * f` to `j * f + f - 1`, low bit first, and stream bit `x` is bit `x & 31` of word `x >>> 5`, so a slot can straddle two words. A slot value of 0 means empty. The body is exactly `32` plus the padded word length; a reader rejects any other length, nonzero padding (in the params, in the bits of the last word past `m`, and in the trailing bytes), and a `count` that differs from the number of nonzero slots.

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

### Hash variant (flags nibble)

Bits 0-3 of the flags byte name the complete scheme that turns a key into stored bits: the hash **and the index mapping** from its output to positions, not the hash alone. A change to any component takes a new variant, even when the hash itself is unchanged, because a reader that recognises the old variant would otherwise read every stored frame at the wrong positions with no error. Version 5 uses one scheme for every structure:

- `0` = murmur3_x86_128 (Bloom, Blocked, Fuse, HyperLogLog, Scalable, Cuckoo) with the index mapping below

Variant `0` covers:

- **Shared:** a string key is hashed as its UTF-8 bytes, a byte key as its bytes unchanged. A JS string is UTF-16 and can hold a lone surrogate, which has no UTF-8 form; it encodes as U+FFFD (`EF BF BD`), as `TextEncoder` does, so a reader in another language must apply the same replacement before hashing; murmur3_x86_128 runs with the frame's seed (Fuse hashes with seed 0) and yields four `u32` output words `w0` to `w3`.
- **Bloom:** `a = w0`, `b = w1`; probe `g_i = (a + i*b + i*i) mod 2^32` for `i = 0..k-1`; each reduced into `[0, m)` by Lemire multiply-shift, the high 32 bits of `g_i * m`.
- **Blocked:** block `= (w0 * numBlocks) >>> 32`; lane `i` of that block sets bit `(w1 * SALT[i] mod 2^32) >>> 27`, over the eight Parquet/Impala split-block salts `0x47b6137b`, `0x44974d91`, `0x8824ad5b`, `0xa2b7289d`, `0x705495c7`, `0x2df1424b`, `0x9efc4947`, `0x5c6bfb31`.
- **Fuse:** the 64-bit key hash `w1:w0` (`w1` high), plus the params `seed` (the attempt seed the build settled on) mod `2^64`, finalised by MurmurHash3's `fmix64` into `mix`; `h0 = (mix * segCountLen) >>> 64`, `h1 = (h0 + seg) ^ ((mix >>> 18) & segMask)`, `h2 = (h0 + 2*seg) ^ (mix_lo & segMask)`, where `segMask = seg - 1`; fingerprint `(mix_lo ^ mix_hi) & mask`, with `mask` `0xff` for Fuse8 and `0xffff` for Fuse16. A key is present when `fp[h0] ^ fp[h1] ^ fp[h2]` equals its fingerprint. Fuse16 fingerprints are `u16` little-endian.
- **HyperLogLog:** register `=` the top `p` bits of `w0`; rho `=` leading zeros + 1 over the remaining `64 - p` bits of `w0:w1`; a sparse entry's index is the top 25 bits of `w0`.
- **Scalable:** a key is hashed once with the frame's seed, and every stage applies the Bloom mapping above to that one hash with its own `m` and `k`.
- **Cuckoo:** fingerprint `fp = (w1 >>> (32 - f))`, or 1 when that is 0; bucket `i1 = reduce(w0, buckets)`; the other bucket `(fp * 0x5bd1e995 mod 2^32 mod buckets + buckets - i1) mod buckets`; an eviction walk starts from bit 0 of `w2` and draws its victim slots from a xorshift32 seeded with `w3 | 1`. The full rules are in the type 7 section above.

This is the case Guava hit: `MURMUR128_MITZ_32` and `MURMUR128_MITZ_64` use the same hash and differ only in how its 128 bits map to indices, yet the change still needed a new `Strategy` ordinal because the stored bits differ. Guava's ordinal covers the whole strategy, and this nibble does too.

All six structures write variant `0` and reject any other variant on read with `UnknownHashVariantError`. Version 3 unified the hash: at version 2 Bloom/Blocked used murmur3_x86_32 and Fuse used MurmurHash3_x64_128, which is no longer accepted. Version 4 changed only the frame header and version 5 only the params padding; neither touched the hash.

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
