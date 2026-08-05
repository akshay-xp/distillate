# Serialization

Versioned, self-describing, little-endian binary format. Spec'd here so Rust/Go readers can parse it. Not decorator/reflect-metadata magic (that is what breaks incumbents on edge).

## Layout

```
Offset  Size  Field
0       4     Magic "AMQF" (0x41 4D 51 46)
4       1     Format version (u8)         # bump on incompatible layout change
5       1     Structure type (u8)         # 1=Bloom 2=BlockedBloom 3=Fuse8 4=Fuse16
                                          # (5+ reserved: CountingBloom, ScalableBloom, Cuckoo, ...)
6       1     Flags (u8)                  # bit0-3 hash variant, others reserved
7       1     Reserved (u8, 0)            # keeps params 8-byte aligned
8       ...   Params block (fixed per type, see below)
...     ...   Payload: raw backing typed array, little-endian
end     4     CRC32 of all preceding bytes
```

Current `FORMAT_VERSION` is `2`. Readers reject any other version (`UnknownVersionError`), and validate the body length against the declared params before allocating.

### Params block per type (version 2)

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

### Hash variant (flags nibble)

Bits 0-3 of the flags byte record which hash produced the stored bits, since the same layout can hold either:

- `0` = MurmurHash3_x64_128 (Fuse)
- `1` = murmur3_x86_32 (Bloom, Blocked)

Bloom and Blocked write variant `1` and reject any other variant on read with `UnknownHashVariantError`; Fuse writes and expects `0`. This is why a hash change needs no format-version bump: the layout is unchanged, only the variant nibble moves, and it is per-structure, so changing the Bloom/Blocked hash leaves Fuse frames readable.

Forward-compat caveat: the variant check protects a newer reader from an older frame (it refuses rather than misreads). It does not protect an older reader, which predates the check and would silently misread a newer-variant frame. A consumer must therefore be at least as new as the producer.

## API

```ts
filter.toBytes(): Uint8Array          // copies backing store verbatim into payload
Structure.fromBytes(b: Uint8Array): Filter
```

Plus a JSON view (`toJSON`) for debugging only, not the persistence format.

## Principles

- All multi-byte integers little-endian via `DataView`, `littleEndian: true` explicit. Native order on x86/ARM; never rely on platform default.
- 64-bit fields via `getBigUint64`/`setBigUint64`.
- Payload is the raw backing array copied verbatim. A same-params Rust/Go reader reconstructs by pointing at these bytes (how FastFilter serializes).
- Serialize mathematical params, not JS object internals. That is what makes cross-language real.
- Pin the hash variant in flags (see [hashing.md](hashing.md)).
- Magic byte rejects foreign/corrupt input early; version byte lets readers refuse unknown formats instead of misparsing; CRC32 detects corruption.

## Input handling

Accept `Uint8Array` or `ArrayBuffer`. Respect `byteOffset`/`byteLength`: build the `DataView` from `(buf.buffer, buf.byteOffset, buf.byteLength)`. Classic bug source.

## Stability

Golden-file tests: commit known-good serialized filters, assert current code still reads them across versions. Malformed-input fuzzing: bad magic, unknown version, wrong type, truncation, bit-flip, CRC mismatch each throw a typed error, never crash or read out of bounds.

The format spec is published as a standalone doc for other-language implementers.
