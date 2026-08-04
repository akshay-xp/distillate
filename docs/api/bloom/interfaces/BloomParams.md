[**distillate**](../../README.md)

***

[distillate](../../README.md) / [bloom](../README.md) / BloomParams

# Interface: BloomParams

Defined in: [src/bloom/bloom.ts:21](https://github.com/akshay-xp/distillate/blob/main/src/bloom/bloom.ts#L21)

Low-level Bloom filter parameters.

## Properties

### k

> **k**: `number`

Defined in: [src/bloom/bloom.ts:25](https://github.com/akshay-xp/distillate/blob/main/src/bloom/bloom.ts#L25)

Number of hash probes per key.

***

### m

> **m**: `number`

Defined in: [src/bloom/bloom.ts:23](https://github.com/akshay-xp/distillate/blob/main/src/bloom/bloom.ts#L23)

Number of bits in the filter.

***

### seed?

> `optional` **seed?**: `number`

Defined in: [src/bloom/bloom.ts:27](https://github.com/akshay-xp/distillate/blob/main/src/bloom/bloom.ts#L27)

Hash seed; defaults to `0`.
