[**distillate**](../../README.md)

***

[distillate](../../README.md) / [bloom](../README.md) / BloomFilter

# Class: BloomFilter

Defined in: [src/bloom/bloom.ts:42](https://github.com/akshay-xp/distillate/blob/main/src/bloom/bloom.ts#L42)

A classic Bloom filter: a space-efficient set with a tunable false-positive
rate and zero false negatives.

## Example

```ts
const filter = BloomFilter.create(100_000, 0.01);
filter.add("alice");
filter.has("alice"); // true
filter.has("bob"); // false (or a ~1% false positive)
```

## Constructors

### Constructor

> **new BloomFilter**(`__namedParameters`): `BloomFilter`

Defined in: [src/bloom/bloom.ts:86](https://github.com/akshay-xp/distillate/blob/main/src/bloom/bloom.ts#L86)

Constructs a filter from low-level [BloomParams](../interfaces/BloomParams.md). Prefer
[BloomFilter.create](#create) unless restoring a specific configuration.

#### Parameters

##### \_\_namedParameters

[`BloomParams`](../interfaces/BloomParams.md)

#### Returns

`BloomFilter`

## Accessors

### bitsPerKey

#### Get Signature

> **get** **bitsPerKey**(): `number`

Defined in: [src/bloom/bloom.ts:99](https://github.com/akshay-xp/distillate/blob/main/src/bloom/bloom.ts#L99)

Analytic design bits-per-key `m / n`.

##### Returns

`number`

## Methods

### add()

> **add**(`key`): `void`

Defined in: [src/bloom/bloom.ts:150](https://github.com/akshay-xp/distillate/blob/main/src/bloom/bloom.ts#L150)

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

Defined in: [src/bloom/bloom.ts:161](https://github.com/akshay-xp/distillate/blob/main/src/bloom/bloom.ts#L161)

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

Defined in: [src/bloom/bloom.ts:108](https://github.com/akshay-xp/distillate/blob/main/src/bloom/bloom.ts#L108)

Serializes the filter to a portable little-endian byte layout.

#### Returns

`Uint8Array`

The serialized filter, readable by [BloomFilter.fromBytes](#frombytes).

***

### union()

> **union**(`other`): `BloomFilter`

Defined in: [src/bloom/bloom.ts:126](https://github.com/akshay-xp/distillate/blob/main/src/bloom/bloom.ts#L126)

Returns a new filter containing the union of this filter and `other`.

#### Parameters

##### other

`BloomFilter`

A filter built with identical parameters.

#### Returns

`BloomFilter`

A new filter reporting membership for keys in either input.

#### Throws

[BloomParamMismatchError](BloomParamMismatchError.md) if the parameters differ.

***

### create()

> `static` **create**(`n`, `epsilon`): `BloomFilter`

Defined in: [src/bloom/bloom.ts:57](https://github.com/akshay-xp/distillate/blob/main/src/bloom/bloom.ts#L57)

Creates a filter sized for `n` expected keys at a target false-positive rate.

#### Parameters

##### n

`number`

Expected number of keys.

##### epsilon

`number`

Target false-positive rate, e.g. `0.01` for 1%.

#### Returns

`BloomFilter`

A new, empty filter.

***

### fromBytes()

> `static` **fromBytes**(`bytes`): `BloomFilter`

Defined in: [src/bloom/bloom.ts:71](https://github.com/akshay-xp/distillate/blob/main/src/bloom/bloom.ts#L71)

Restores a filter from its [BloomFilter.toBytes](#tobytes) serialization.

#### Parameters

##### bytes

`Uint8Array`

The serialized filter.

#### Returns

`BloomFilter`

The reconstructed filter.
