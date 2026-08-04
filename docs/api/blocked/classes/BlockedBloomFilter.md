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

## Methods

### add()

> **add**(`key`): `void`

Defined in: [src/blocked/blocked.ts:190](https://github.com/akshay-xp/distillate/blob/main/src/blocked/blocked.ts#L190)

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

Defined in: [src/blocked/blocked.ts:204](https://github.com/akshay-xp/distillate/blob/main/src/blocked/blocked.ts#L204)

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

Defined in: [src/blocked/blocked.ts:147](https://github.com/akshay-xp/distillate/blob/main/src/blocked/blocked.ts#L147)

Serializes the filter to a portable little-endian byte layout.

#### Returns

`Uint8Array`

The serialized filter, readable by [BlockedBloomFilter.fromBytes](#frombytes).

***

### union()

> **union**(`other`): `BlockedBloomFilter`

Defined in: [src/blocked/blocked.ts:169](https://github.com/akshay-xp/distillate/blob/main/src/blocked/blocked.ts#L169)

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

Defined in: [src/blocked/blocked.ts:124](https://github.com/akshay-xp/distillate/blob/main/src/blocked/blocked.ts#L124)

Restores a filter from its [BlockedBloomFilter.toBytes](#tobytes) serialization.

#### Parameters

##### bytes

`Uint8Array`

The serialized filter.

#### Returns

`BlockedBloomFilter`

The reconstructed filter.
