[**distillate**](../../README.md)

---

[distillate](../../README.md) / [blocked](../README.md) / BlockedBloomParams

# Interface: BlockedBloomParams

Defined in: [packages/distillate/src/blocked/blocked.ts:50](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/blocked/blocked.ts#L50)

Low-level blocked Bloom filter parameters.

## Properties

### bitsPerKey

> **bitsPerKey**: `number`

Defined in: [packages/distillate/src/blocked/blocked.ts:52](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/blocked/blocked.ts#L52)

Bits allocated per key; higher lowers the false-positive rate.

---

### capacity

> **capacity**: `number`

Defined in: [packages/distillate/src/blocked/blocked.ts:54](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/blocked/blocked.ts#L54)

Expected number of keys.

---

### seed?

> `optional` **seed?**: `number`

Defined in: [packages/distillate/src/blocked/blocked.ts:56](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/blocked/blocked.ts#L56)

Hash seed; defaults to `0`.
