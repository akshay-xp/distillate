[**distillate**](../../README.md)

---

[distillate](../../README.md) / [bloom](../README.md) / BloomParams

# Interface: BloomParams

Defined in: [packages/distillate/src/bloom/bloom.ts:35](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/bloom/bloom.ts#L35)

Low-level Bloom filter parameters.

## Properties

### k

> **k**: `number`

Defined in: [packages/distillate/src/bloom/bloom.ts:39](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/bloom/bloom.ts#L39)

Number of hash probes per key.

---

### m

> **m**: `number`

Defined in: [packages/distillate/src/bloom/bloom.ts:37](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/bloom/bloom.ts#L37)

Number of bits in the filter.

---

### seed?

> `optional` **seed?**: `number`

Defined in: [packages/distillate/src/bloom/bloom.ts:41](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/bloom/bloom.ts#L41)

Hash seed; defaults to `0`.
