[**distillate**](../../README.md)

***

[distillate](../../README.md) / [blocked](../README.md) / BlockedBloomParams

# Interface: BlockedBloomParams

Defined in: [src/blocked/blocked.ts:47](https://github.com/akshay-xp/distillate/blob/main/src/blocked/blocked.ts#L47)

Low-level blocked Bloom filter parameters.

## Properties

### bitsPerKey

> **bitsPerKey**: `number`

Defined in: [src/blocked/blocked.ts:49](https://github.com/akshay-xp/distillate/blob/main/src/blocked/blocked.ts#L49)

Bits allocated per key; higher lowers the false-positive rate.

***

### capacity

> **capacity**: `number`

Defined in: [src/blocked/blocked.ts:51](https://github.com/akshay-xp/distillate/blob/main/src/blocked/blocked.ts#L51)

Expected number of keys.

***

### seed?

> `optional` **seed?**: `number`

Defined in: [src/blocked/blocked.ts:53](https://github.com/akshay-xp/distillate/blob/main/src/blocked/blocked.ts#L53)

Hash seed; defaults to `0`.
