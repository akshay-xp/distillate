[**distillate**](../../README.md)

***

[distillate](../../README.md) / [bloom](../README.md) / BloomParams

# Interface: BloomParams

Defined in: [src/bloom/bloom.ts:16](https://github.com/akshay-xp/distillate/blob/main/src/bloom/bloom.ts#L16)

Low-level Bloom filter parameters.

## Properties

### k

> **k**: `number`

Defined in: [src/bloom/bloom.ts:20](https://github.com/akshay-xp/distillate/blob/main/src/bloom/bloom.ts#L20)

Number of hash probes per key.

***

### m

> **m**: `number`

Defined in: [src/bloom/bloom.ts:18](https://github.com/akshay-xp/distillate/blob/main/src/bloom/bloom.ts#L18)

Number of bits in the filter.

***

### seed?

> `optional` **seed?**: `number`

Defined in: [src/bloom/bloom.ts:22](https://github.com/akshay-xp/distillate/blob/main/src/bloom/bloom.ts#L22)

Hash seed; defaults to `0`.
