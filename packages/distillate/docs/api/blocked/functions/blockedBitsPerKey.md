[**distillate**](../../README.md)

---

[distillate](../../README.md) / [blocked](../README.md) / blockedBitsPerKey

# Function: blockedBitsPerKey()

> **blockedBitsPerKey**(`epsilon`): `number`

Defined in: [packages/distillate/src/blocked/blocked.ts:77](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/blocked/blocked.ts#L77)

Minimal integer bits-per-key whose modeled split-block FPR is at or below
`epsilon`. Throws [ParamError](../../bloom/classes/ParamError.md) when even the densest supported filter
cannot reach the target, so callers get a typed rejection instead of a
silently under-provisioned filter.

## Parameters

### epsilon

`number`

## Returns

`number`
