---
title: Serialization format
description: The versioned, self-describing DSTL binary format, covering byte layout, per-type params blocks, hash variant, and the rules a reader in any language must follow.
---

Versioned, self-describing, little-endian binary format. Spec'd here so Rust/Go readers can parse it. Not decorator/reflect-metadata magic (that is what breaks incumbents on edge).

## Layout

```
Offset  Size  Field
0       4     Magic "DSTL" (0x44 53 54 4C)
4       1     Format version (u8)         # bump on incompatible layout change
5       1     Structure type (u8)         # 1=Bloom 2=BlockedBloom 3=Fuse8 4=Fuse16 5=HyperLogLog
                                          # (6+ reserved: CountingBloom, Cuckoo, ...)
6       1     Flags (u8)                  # bit0-3 hash variant, others reserved
7       1     Reserved (u8, 0)
8       4     Body length (u32)           # bytes of body, excluding header and CRC
12      4     Reserved (u32, 0)           # keeps the body 8-byte aligned
16      ...   Body: params block (fixed per type, see below)
...     ...   Payload: raw backing typed array, host byte order (see Principles)
end     4     CRC32 of all preceding bytes
```

Current `FORMAT_VERSION` is `4`. Readers reject any other version (`UnknownVersionError`).

The body length makes a frame self-describing: a reader can validate, skip, or stream a frame of a structure type it does not implement, using the header alone. It is checked against the bytes actually present _before_ the CRC, so a frame cut short in transit reports `TruncatedError` rather than the checksum failure truncation also implies. Readers additionally validate the body length against the declared params before allocating, which catches a frame whose header is internally consistent but whose params disagree with the payload size.

### Version 4 is a hard break

Version 4 renamed the magic from `AMQF` (_Approximate Membership Query Filter_) to `DSTL`, because `distillate` serializes structures that are not membership filters. There is no dual-magic read path: a pre-v4 frame fails on magic with `BadMagicError`, not on version. Re-serialize such data with the version you run.

### Params block per type (version 4)

Params offsets below are relative to the start of the body (frame offset 16).

Bloom (type 1), little-endian:

```
Offset  Size  Field
0       4     m: number of bits (u32)
4       2     k: number of hash probes (u16)
6       4     seed (u32)
10      4     n: expected key count (u32)
14      ...   payload: bit array, ceil(m / 8) bytes
```

Blocked (type 2): `numBlocks (u32) | seed (u32) | n (u32)`, then the lane words (`numBlocks * 32` bytes). Fuse (types 3 and 4): `seed (u32) | seg (u32) | segCountLen (u32) | size (u32)`, then the fingerprint array.

HyperLogLog (type 5), little-endian:

```
Offset  Size  Field
0       1     p: precision, 4..18 (u8)
1       1     encoding (u8)
2       4     seed (u32)
6       ...   payload: dense registers or sparse entries, see below
```

### Hash variant (flags nibble)

Bits 0-3 of the flags byte record which hash produced the stored bits. Version 4 uses one hash for every structure:

- `0` = murmur3_x86_128 (Bloom, Blocked, Fuse)

All three structures write variant `0` and reject any other variant on read with `UnknownHashVariantError`. Version 3 unified the hash: at version 2 Bloom/Blocked used murmur3_x86_32 and Fuse used MurmurHash3_x64_128, which is no longer accepted. Version 4 changed only the frame header, not the hash.

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
- Payload is the raw backing typed array copied verbatim, so its multi-byte lanes (blocked's `Uint32Array` lane words, fuse16's `Uint16Array` fingerprints) land in host byte order, not a forced little-endian. Every supported JS runtime is little-endian, so on-disk frames are interoperable in practice; a hypothetical big-endian host would need a read-time byte-swap, which is not currently implemented. Bloom bit arrays and fuse8 fingerprints are `Uint8Array`, so they are endian-neutral. A same-params Rust/Go reader reconstructs by pointing at these bytes (how FastFilter serializes).
- Serialize mathematical params, not JS object internals. That is what makes cross-language real.
- Pin the hash variant in flags (see [hashing](/internals/hashing/)).
- Magic byte rejects foreign/corrupt input early; version byte lets readers refuse unknown formats instead of misparsing; CRC32 detects corruption.
- The header is self-describing: magic, version, type, and body length are readable without knowing the structure, so a generic reader can frame every record in a stream and skip the types it does not implement.

## Input handling

Accept `Uint8Array` or `ArrayBuffer`. Respect `byteOffset`/`byteLength`: build the `DataView` from `(buf.buffer, buf.byteOffset, buf.byteLength)`. Classic bug source.

## Stability

Golden fixtures pin the exact byte layout, which round-trip tests miss (`toBytes`/`fromBytes` drift together and stay mutually consistent). [`tests/fixtures/golden.json`](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/tests/fixtures/golden.json) holds a base64 `frame` per structure (one v4 per type, plus a stale-version frame), rebuilt from committed keys. `tests/core/golden.test.ts` asserts each v4 frame parses, contains its keys, re-serializes to the same bytes, and matches a fresh build from the recipe (so a layout change fails the fresh-build check); the stale-version frame must throw `UnknownVersionError`. That fixture is a current frame with its version byte overwritten, so it keeps the `DSTL` magic and reaches the version check; a genuine pre-v4 frame carries `AMQF` and is rejected on magic first, which each structure's own suite covers directly. Fixtures are committed and never regenerated in CI; on an intentional format bump, `pnpm golden:gen` (`scripts/gen-golden.ts`) refreshes them, and its output is byte-identical to the committed prettier format.

Malformed-input fuzzing: bad magic, unknown version, wrong type, truncation, declared-length mismatch, bit-flip, CRC mismatch each throw a typed error, never crash or read out of bounds.

The format spec is published as a standalone doc for other-language implementers.
