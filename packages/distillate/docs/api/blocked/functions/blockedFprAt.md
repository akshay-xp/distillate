[**distillate**](../../README.md)

---

[distillate](../../README.md) / [blocked](../README.md) / blockedFprAt

# Function: blockedFprAt()

> **blockedFprAt**(`bitsPerKey`): `number`

Defined in: [packages/distillate/src/blocked/blocked.ts:55](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/blocked/blocked.ts#L55)

Modeled false-positive rate of a split-block filter at `bitsPerKey`. A block
holding `j` keys has FPR `(1 - (1 - 1/32)^j)^8` (8 lanes of 32 bits, one probe
each); the filter's rate averages that over the Poisson block load
`lambda = 256 / bitsPerKey`. This clustering average is why the blocked curve
is not linear in `log10(1/epsilon)`.

## Parameters

### bitsPerKey

`number`

## Returns

`number`
