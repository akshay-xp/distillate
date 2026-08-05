[**distillate**](../../README.md)

***

[distillate](../../README.md) / [blocked](../README.md) / BlockedBloomParams

# Interface: BlockedBloomParams

Defined in: [src/blocked/blocked.ts:46](https://github.com/akshay-xp/distillate/blob/main/src/blocked/blocked.ts#L46)

Low-level blocked Bloom filter parameters.

## Properties

### bitsPerKey

> **bitsPerKey**: `number`

Defined in: [src/blocked/blocked.ts:48](https://github.com/akshay-xp/distillate/blob/main/src/blocked/blocked.ts#L48)

Bits allocated per key; higher lowers the false-positive rate.

***

### capacity

> **capacity**: `number`

Defined in: [src/blocked/blocked.ts:50](https://github.com/akshay-xp/distillate/blob/main/src/blocked/blocked.ts#L50)

Expected number of keys.

***

### seed?

> `optional` **seed?**: `number`

Defined in: [src/blocked/blocked.ts:52](https://github.com/akshay-xp/distillate/blob/main/src/blocked/blocked.ts#L52)

Hash seed; defaults to `0`.
