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

Current `FORMAT_VERSION` is `3`. Readers reject any other version (`UnknownVersionError`), and validate the body length against the declared params before allocating.

### Params block per type (version 3)

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

Bits 0-3 of the flags byte record which hash produced the stored bits. Version 3 uses one hash for every structure:

- `0` = murmur3_x86_128 (Bloom, Blocked, Fuse)

All three structures write variant `0` and reject any other variant on read with `UnknownHashVariantError`. Version 3 unified the hash: at version 2 Bloom/Blocked used murmur3_x86_32 and Fuse used MurmurHash3_x64_128, which is no longer accepted.

The version bump (not a flags-only change) was deliberate: the version-2 Fuse reader had no variant check and would silently misread a version-3 frame, so bumping the version makes it reject on the version byte instead.

Forward-compat caveat: the version and variant checks protect a newer reader from an older frame (it refuses rather than misreads). An older reader that predates a check would misread a newer frame, so a consumer must be at least as new as the producer.

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

Golden fixtures pin the exact byte layout, which round-trip tests miss (`toBytes`/`fromBytes` drift together and stay mutually consistent). `tests/fixtures/golden.json` holds a base64 `frame` per structure (one v3 per type, plus a v2 frame), rebuilt from committed keys. `tests/core/golden.test.ts` asserts each v3 frame parses, contains its keys, re-serializes to the same bytes, and matches a fresh build from the recipe (so a layout change fails the fresh-build check); the v2 frame must throw `UnknownVersionError`. Fixtures are committed and never regenerated in CI; on an intentional format bump, `pnpm golden:gen` (`scripts/gen-golden.ts`) refreshes them, and its output is byte-identical to the committed prettier format.

Malformed-input fuzzing: bad magic, unknown version, wrong type, truncation, bit-flip, CRC mismatch each throw a typed error, never crash or read out of bounds.

The format spec is published as a standalone doc for other-language implementers.
