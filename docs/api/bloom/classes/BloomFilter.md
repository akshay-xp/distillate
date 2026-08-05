[**distillate**](../../README.md)

***

[distillate](../../README.md) / [bloom](../README.md) / BloomFilter

# Class: BloomFilter

Defined in: [src/bloom/bloom.ts:51](https://github.com/akshay-xp/distillate/blob/main/src/bloom/bloom.ts#L51)

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

Defined in: [src/bloom/bloom.ts:109](https://github.com/akshay-xp/distillate/blob/main/src/bloom/bloom.ts#L109)

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

Defined in: [src/bloom/bloom.ts:142](https://github.com/akshay-xp/distillate/blob/main/src/bloom/bloom.ts#L142)

Analytic design bits-per-key `m / n`.

##### Returns

`number`

***

### k

#### Get Signature

> **get** **k**(): `number`

Defined in: [src/bloom/bloom.ts:127](https://github.com/akshay-xp/distillate/blob/main/src/bloom/bloom.ts#L127)

Number of hash probes per key.

##### Returns

`number`

***

### length

#### Get Signature

> **get** **length**(): `number`

Defined in: [src/bloom/bloom.ts:137](https://github.com/akshay-xp/distillate/blob/main/src/bloom/bloom.ts#L137)

Number of bits currently set.

##### Returns

`number`

***

### m

#### Get Signature

> **get** **m**(): `number`

Defined in: [src/bloom/bloom.ts:122](https://github.com/akshay-xp/distillate/blob/main/src/bloom/bloom.ts#L122)

Number of bits in the filter.

##### Returns

`number`

***

### seed

#### Get Signature

> **get** **seed**(): `number`

Defined in: [src/bloom/bloom.ts:132](https://github.com/akshay-xp/distillate/blob/main/src/bloom/bloom.ts#L132)

Hash seed.

##### Returns

`number`

## Methods

### add()

> **add**(`key`): `void`

Defined in: [src/bloom/bloom.ts:208](https://github.com/akshay-xp/distillate/blob/main/src/bloom/bloom.ts#L208)

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

Defined in: [src/bloom/bloom.ts:219](https://github.com/akshay-xp/distillate/blob/main/src/bloom/bloom.ts#L219)

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

Defined in: [src/bloom/bloom.ts:153](https://github.com/akshay-xp/distillate/blob/main/src/bloom/bloom.ts#L153)

Estimates the current false-positive rate from the actual fill,
`(length / m) ** k`. This reflects how full the filter is right now, not
the design target; it rises as keys are added.

#### Returns

`number`

The estimated false-positive rate, `0` for an empty filter.

***

### toBytes()

> **toBytes**(): `Uint8Array`

Defined in: [src/bloom/bloom.ts:162](https://github.com/akshay-xp/distillate/blob/main/src/bloom/bloom.ts#L162)

Serializes the filter to a portable little-endian byte layout.

#### Returns

`Uint8Array`

The serialized filter, readable by [BloomFilter.fromBytes](#frombytes).

***

### union()

> **union**(`other`): `BloomFilter`

Defined in: [src/bloom/bloom.ts:184](https://github.com/akshay-xp/distillate/blob/main/src/bloom/bloom.ts#L184)

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

Defined in: [src/bloom/bloom.ts:66](https://github.com/akshay-xp/distillate/blob/main/src/bloom/bloom.ts#L66)

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

Defined in: [src/bloom/bloom.ts:80](https://github.com/akshay-xp/distillate/blob/main/src/bloom/bloom.ts#L80)

Restores a filter from its [BloomFilter.toBytes](#tobytes) serialization.

#### Parameters

##### bytes

`Uint8Array`

The serialized filter.

#### Returns

`BloomFilter`

The reconstructed filter.
