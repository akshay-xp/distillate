[**distillate**](../../README.md)

***

[distillate](../../README.md) / [blocked](../README.md) / BlockedBloomFilter

# Class: BlockedBloomFilter

Defined in: [src/blocked/blocked.ts:57](https://github.com/akshay-xp/distillate/blob/main/src/blocked/blocked.ts#L57)

A blocked (split-block) Bloom filter: confines every lookup to a single cache
line, trading ~20-30% more space for cache-friendly throughput.

## Example

```ts
const filter = BlockedBloomFilter.create(100_000, 0.01);
filter.add("alice");
filter.has("alice"); // true
```

## Constructors

### Constructor

> **new BlockedBloomFilter**(`__namedParameters`): `BlockedBloomFilter`

Defined in: [src/blocked/blocked.ts:103](https://github.com/akshay-xp/distillate/blob/main/src/blocked/blocked.ts#L103)

Constructs a filter from low-level [BlockedBloomParams](../interfaces/BlockedBloomParams.md). Prefer
[BlockedBloomFilter.create](#create) unless restoring a specific configuration.

#### Parameters

##### \_\_namedParameters

[`BlockedBloomParams`](../interfaces/BlockedBloomParams.md)

#### Returns

`BlockedBloomFilter`

## Accessors

### bitsPerKey

#### Get Signature

> **get** **bitsPerKey**(): `number`

Defined in: [src/blocked/blocked.ts:114](https://github.com/akshay-xp/distillate/blob/main/src/blocked/blocked.ts#L114)

Actual bits allocated per key (`total bits / capacity`).

##### Returns

`number`

***

### length

#### Get Signature

> **get** **length**(): `number`

Defined in: [src/blocked/blocked.ts:119](https://github.com/akshay-xp/distillate/blob/main/src/blocked/blocked.ts#L119)

Number of bits currently set across all lanes.

##### Returns

`number`

## Methods

### add()

> **add**(`key`): `void`

Defined in: [src/blocked/blocked.ts:214](https://github.com/akshay-xp/distillate/blob/main/src/blocked/blocked.ts#L214)

Adds a key to the set.

#### Parameters

##### key

`BytesLike`

The key to insert, as a string or bytes.

#### Returns

`void`

***

### has()

> **has**(`key`): `boolean`

Defined in: [src/blocked/blocked.ts:228](https://github.com/akshay-xp/distillate/blob/main/src/blocked/blocked.ts#L228)

Tests whether a key is in the set.

#### Parameters

##### key

`BytesLike`

The key to test.

#### Returns

`boolean`

`true` if present (possibly a false positive); `false` guarantees absence.

***

### rate()

> **rate**(): `number`

Defined in: [src/blocked/blocked.ts:138](https://github.com/akshay-xp/distillate/blob/main/src/blocked/blocked.ts#L138)

Estimates the current false-positive rate from the actual fill,
`(length / totalBits) ** 8`. A split-block query checks exactly 8 lane-bits,
so the exponent is 8 rather than a classic probe count `k`. This reflects
how full the filter is right now, not the design target.

#### Returns

`number`

The estimated false-positive rate, `0` for an empty filter.

***

### toBytes()

> **toBytes**(): `Uint8Array`

Defined in: [src/blocked/blocked.ts:171](https://github.com/akshay-xp/distillate/blob/main/src/blocked/blocked.ts#L171)

Serializes the filter to a portable little-endian byte layout.

#### Returns

`Uint8Array`

The serialized filter, readable by [BlockedBloomFilter.fromBytes](#frombytes).

***

### union()

> **union**(`other`): `BlockedBloomFilter`

Defined in: [src/blocked/blocked.ts:193](https://github.com/akshay-xp/distillate/blob/main/src/blocked/blocked.ts#L193)

Returns a new filter containing the union of this filter and `other`.

#### Parameters

##### other

`BlockedBloomFilter`

A filter built with identical parameters.

#### Returns

`BlockedBloomFilter`

A new filter reporting membership for keys in either input.

#### Throws

[BlockedBloomParamMismatchError](BlockedBloomParamMismatchError.md) if the parameters differ.

***

### create()

> `static` **create**(`n`, `epsilon`): `BlockedBloomFilter`

Defined in: [src/blocked/blocked.ts:81](https://github.com/akshay-xp/distillate/blob/main/src/blocked/blocked.ts#L81)

Creates a filter sized for `n` expected keys at a target false-positive rate.

#### Parameters

##### n

`number`

Expected number of keys.

##### epsilon

`number`

Target false-positive rate, e.g. `0.01` for 1%.

#### Returns

`BlockedBloomFilter`

A new, empty filter.

***

### fromBytes()

> `static` **fromBytes**(`bytes`): `BlockedBloomFilter`

Defined in: [src/blocked/blocked.ts:148](https://github.com/akshay-xp/distillate/blob/main/src/blocked/blocked.ts#L148)

Restores a filter from its [BlockedBloomFilter.toBytes](#tobytes) serialization.

#### Parameters

##### bytes

`Uint8Array`

The serialized filter.

#### Returns

`BlockedBloomFilter`

The reconstructed filter.
