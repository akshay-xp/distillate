[**distillate**](../../README.md)

---

[distillate](../../README.md) / [bloom](../README.md) / BloomParams

# Interface: BloomParams

Defined in: [packages/distillate/src/bloom/bloom.ts:34](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/bloom/bloom.ts#L34)

Low-level Bloom filter parameters.

## Properties

### k

> **k**: `number`

Defined in: [packages/distillate/src/bloom/bloom.ts:38](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/bloom/bloom.ts#L38)

Number of hash probes per key.

---

### m

> **m**: `number`

Defined in: [packages/distillate/src/bloom/bloom.ts:36](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/bloom/bloom.ts#L36)

Number of bits in the filter.

---

### seed?

> `optional` **seed?**: `number`

Defined in: [packages/distillate/src/bloom/bloom.ts:40](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/bloom/bloom.ts#L40)

Hash seed; defaults to `0`.
