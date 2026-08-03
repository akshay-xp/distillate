[**distillate**](../../README.md)

***

[distillate](../../README.md) / [blocked](../README.md) / BlockedBloomFilter

# Class: BlockedBloomFilter

Defined in: [src/blocked/blocked.ts:51](https://github.com/akshay-xp/distillate/blob/main/src/blocked/blocked.ts#L51)

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

Defined in: [src/blocked/blocked.ts:95](https://github.com/akshay-xp/distillate/blob/main/src/blocked/blocked.ts#L95)

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

Defined in: [src/blocked/blocked.ts:103](https://github.com/akshay-xp/distillate/blob/main/src/blocked/blocked.ts#L103)

Actual bits allocated per key (`total bits / capacity`).

##### Returns

`number`

## Methods

### add()

> **add**(`key`): `void`

Defined in: [src/blocked/blocked.ts:179](https://github.com/akshay-xp/distillate/blob/main/src/blocked/blocked.ts#L179)

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

Defined in: [src/blocked/blocked.ts:193](https://github.com/akshay-xp/distillate/blob/main/src/blocked/blocked.ts#L193)

Tests whether a key is in the set.

#### Parameters

##### key

`BytesLike`

The key to test.

#### Returns

`boolean`

`true` if present (possibly a false positive); `false` guarantees absence.

***

### toBytes()

> **toBytes**(): `Uint8Array`

Defined in: [src/blocked/blocked.ts:136](https://github.com/akshay-xp/distillate/blob/main/src/blocked/blocked.ts#L136)

Serializes the filter to a portable little-endian byte layout.

#### Returns

`Uint8Array`

The serialized filter, readable by [BlockedBloomFilter.fromBytes](#frombytes).

***

### union()

> **union**(`other`): `BlockedBloomFilter`

Defined in: [src/blocked/blocked.ts:158](https://github.com/akshay-xp/distillate/blob/main/src/blocked/blocked.ts#L158)

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

Defined in: [src/blocked/blocked.ts:75](https://github.com/akshay-xp/distillate/blob/main/src/blocked/blocked.ts#L75)

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

Defined in: [src/blocked/blocked.ts:113](https://github.com/akshay-xp/distillate/blob/main/src/blocked/blocked.ts#L113)

Restores a filter from its [BlockedBloomFilter.toBytes](#tobytes) serialization.

#### Parameters

##### bytes

`Uint8Array`

The serialized filter.

#### Returns

`BlockedBloomFilter`

The reconstructed filter.
