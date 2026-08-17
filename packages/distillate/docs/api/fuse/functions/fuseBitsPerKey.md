[**distillate**](../../README.md)

---

[distillate](../../README.md) / [fuse](../README.md) / fuseBitsPerKey

# Function: fuseBitsPerKey()

> **fuseBitsPerKey**(`n`, `width`): `number`

Defined in: [packages/distillate/src/fuse/fuse.ts:117](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/fuse/fuse.ts#L117)

Bits stored per key by a binary fuse filter over `n` keys at a fingerprint
width, without building one. Counts `n` as distinct keys, since a built
filter sizes on its deduped hash count.

## Parameters

### n

`number`

Number of distinct keys.

### width

`8` \| `16`

Fingerprint width in bits: `8` for [BinaryFuse8](../classes/BinaryFuse8.md), `16` for [BinaryFuse16](../classes/BinaryFuse16.md).

## Returns

`number`

Bits per key (`0` for an empty filter).
