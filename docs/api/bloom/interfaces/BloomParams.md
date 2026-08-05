[**distillate**](../../README.md)

***

[distillate](../../README.md) / [bloom](../README.md) / BloomParams

# Interface: BloomParams

Defined in: [src/bloom/bloom.ts:30](https://github.com/akshay-xp/distillate/blob/main/src/bloom/bloom.ts#L30)

Low-level Bloom filter parameters.

## Properties

### k

> **k**: `number`

Defined in: [src/bloom/bloom.ts:34](https://github.com/akshay-xp/distillate/blob/main/src/bloom/bloom.ts#L34)

Number of hash probes per key.

***

### m

> **m**: `number`

Defined in: [src/bloom/bloom.ts:32](https://github.com/akshay-xp/distillate/blob/main/src/bloom/bloom.ts#L32)

Number of bits in the filter.

***

### seed?

> `optional` **seed?**: `number`

Defined in: [src/bloom/bloom.ts:36](https://github.com/akshay-xp/distillate/blob/main/src/bloom/bloom.ts#L36)

Hash seed; defaults to `0`.
