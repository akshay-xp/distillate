[**distillate**](../../README.md)

---

[distillate](../../README.md) / [blocked](../README.md) / BlockedBloomParams

# Interface: BlockedBloomParams

Defined in: [packages/distillate/src/blocked/blocked.ts:93](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/blocked/blocked.ts#L93)

Low-level blocked Bloom filter parameters.

## Properties

### bitsPerKey

> **bitsPerKey**: `number`

Defined in: [packages/distillate/src/blocked/blocked.ts:95](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/blocked/blocked.ts#L95)

Bits allocated per key; higher lowers the false-positive rate.

---

### capacity

> **capacity**: `number`

Defined in: [packages/distillate/src/blocked/blocked.ts:97](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/blocked/blocked.ts#L97)

Expected number of keys.

---

### seed?

> `optional` **seed?**: `number`

Defined in: [packages/distillate/src/blocked/blocked.ts:99](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/blocked/blocked.ts#L99)

Hash seed; defaults to `0`.
