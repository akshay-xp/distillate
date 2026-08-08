[**distillate**](../../README.md)

***

[distillate](../../README.md) / [bloom](../README.md) / BloomParams

# Interface: BloomParams

Defined in: [src/bloom/bloom.ts:31](https://github.com/akshay-xp/distillate/blob/main/src/bloom/bloom.ts#L31)

Low-level Bloom filter parameters.

## Properties

### k

> **k**: `number`

Defined in: [src/bloom/bloom.ts:35](https://github.com/akshay-xp/distillate/blob/main/src/bloom/bloom.ts#L35)

Number of hash probes per key.

***

### m

> **m**: `number`

Defined in: [src/bloom/bloom.ts:33](https://github.com/akshay-xp/distillate/blob/main/src/bloom/bloom.ts#L33)

Number of bits in the filter.

***

### seed?

> `optional` **seed?**: `number`

Defined in: [src/bloom/bloom.ts:37](https://github.com/akshay-xp/distillate/blob/main/src/bloom/bloom.ts#L37)

Hash seed; defaults to `0`.
