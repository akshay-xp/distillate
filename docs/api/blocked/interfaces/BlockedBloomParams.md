[**distillate**](../../README.md)

***

[distillate](../../README.md) / [blocked](../README.md) / BlockedBloomParams

# Interface: BlockedBloomParams

Defined in: [src/blocked/blocked.ts:37](https://github.com/akshay-xp/distillate/blob/main/src/blocked/blocked.ts#L37)

Low-level blocked Bloom filter parameters.

## Properties

### bitsPerKey

> **bitsPerKey**: `number`

Defined in: [src/blocked/blocked.ts:39](https://github.com/akshay-xp/distillate/blob/main/src/blocked/blocked.ts#L39)

Bits allocated per key; higher lowers the false-positive rate.

***

### capacity

> **capacity**: `number`

Defined in: [src/blocked/blocked.ts:41](https://github.com/akshay-xp/distillate/blob/main/src/blocked/blocked.ts#L41)

Expected number of keys.

***

### seed?

> `optional` **seed?**: `number`

Defined in: [src/blocked/blocked.ts:43](https://github.com/akshay-xp/distillate/blob/main/src/blocked/blocked.ts#L43)

Hash seed; defaults to `0`.
