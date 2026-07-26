# Serialization

Versioned, self-describing, little-endian binary format. Spec'd here so Rust/Go readers can parse it. Not decorator/reflect-metadata magic (that is what breaks incumbents on edge).

## Layout

```
Offset  Size  Field
0       4     Magic "AMQF" (0x41 4D 51 46)
4       1     Format version (u8)         # bump on incompatible layout change
5       1     Structure type (u8)         # 1=Bloom 2=BlockedBloom 3=CountingBloom
                                          # 4=ScalableBloom 5=Cuckoo 6=Fuse8 7=Fuse16 ...
6       1     Flags (u8)                  # bit0-3 hash variant, others reserved
7       1     Reserved (u8, 0)            # keeps params 8-byte aligned
8       ...   Params block (fixed per type: k, m, seed(s), fingerprint bits,
              segment length, segment count, capacity, item count)
...     ...   Payload: raw backing typed array, little-endian
end     4     CRC32 of all preceding bytes
```

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
