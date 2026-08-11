[**distillate**](../../README.md)

---

[distillate](../../README.md) / [bloom](../README.md) / BloomFilter

# Class: BloomFilter

Defined in: [packages/distillate/src/bloom/bloom.ts:56](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/bloom/bloom.ts#L56)

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

Defined in: [packages/distillate/src/bloom/bloom.ts:128](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/bloom/bloom.ts#L128)

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

Defined in: [packages/distillate/src/bloom/bloom.ts:172](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/bloom/bloom.ts#L172)

Analytic design bits-per-key `m / n`.

##### Returns

`number`

---

### k

#### Get Signature

> **get** **k**(): `number`

Defined in: [packages/distillate/src/bloom/bloom.ts:157](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/bloom/bloom.ts#L157)

Number of hash probes per key.

##### Returns

`number`

---

### length

#### Get Signature

> **get** **length**(): `number`

Defined in: [packages/distillate/src/bloom/bloom.ts:167](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/bloom/bloom.ts#L167)

Number of bits currently set.

##### Returns

`number`

---

### m

#### Get Signature

> **get** **m**(): `number`

Defined in: [packages/distillate/src/bloom/bloom.ts:152](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/bloom/bloom.ts#L152)

Number of bits in the filter.

##### Returns

`number`

---

### seed

#### Get Signature

> **get** **seed**(): `number`

Defined in: [packages/distillate/src/bloom/bloom.ts:162](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/bloom/bloom.ts#L162)

Hash seed.

##### Returns

`number`

## Methods

### add()

> **add**(`key`): `void`

Defined in: [packages/distillate/src/bloom/bloom.ts:272](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/bloom/bloom.ts#L272)

Adds a key to the set.

#### Parameters

##### key

`BytesLike`

The key to insert, as a string or bytes.

#### Returns

`void`

---

### equals()

> **equals**(`other`): `boolean`

Defined in: [packages/distillate/src/bloom/bloom.ts:214](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/bloom/bloom.ts#L214)

Tests structural equality: `true` when `other` serializes to identical
bytes, meaning identical parameters and set bits.

#### Parameters

##### other

`BloomFilter`

The filter to compare against.

#### Returns

`boolean`

`true` if the two filters are byte-for-byte identical.

---

### has()

> **has**(`key`): `boolean`

Defined in: [packages/distillate/src/bloom/bloom.ts:283](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/bloom/bloom.ts#L283)

Tests whether a key is in the set.

#### Parameters

##### key

`BytesLike`

The key to test.

#### Returns

`boolean`

`true` if present (possibly a false positive); `false` guarantees absence.

---

### rate()

> **rate**(): `number`

Defined in: [packages/distillate/src/bloom/bloom.ts:183](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/bloom/bloom.ts#L183)

Estimates the current false-positive rate from the actual fill,
`(length / m) ** k`. This reflects how full the filter is right now, not
the design target; it rises as keys are added.

#### Returns

`number`

The estimated false-positive rate, `0` for an empty filter.

---

### toBytes()

> **toBytes**(): `Uint8Array`

Defined in: [packages/distillate/src/bloom/bloom.ts:192](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/bloom/bloom.ts#L192)

Serializes the filter to a portable little-endian byte layout.

#### Returns

`Uint8Array`

The serialized filter, readable by [BloomFilter.fromBytes](#frombytes).

---

### toJSON()

> **toJSON**(): [`FilterJSON`](../interfaces/FilterJSON.md)

Defined in: [packages/distillate/src/bloom/bloom.ts:224](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/bloom/bloom.ts#L224)

Serializes the filter to a JSON-friendly envelope wrapping the base64 of
[BloomFilter.toBytes](#tobytes).

#### Returns

[`FilterJSON`](../interfaces/FilterJSON.md)

The envelope, readable by [BloomFilter.fromJSON](#fromjson).

---

### union()

> **union**(`other`): `BloomFilter`

Defined in: [packages/distillate/src/bloom/bloom.ts:245](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/bloom/bloom.ts#L245)

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

---

### create()

> `static` **create**(`n`, `epsilon`): `BloomFilter`

Defined in: [packages/distillate/src/bloom/bloom.ts:71](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/bloom/bloom.ts#L71)

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

---

### from()

> `static` **from**(`keys`, `epsilon`): `BloomFilter`

Defined in: [packages/distillate/src/bloom/bloom.ts:87](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/bloom/bloom.ts#L87)

Builds a filter from `keys`, sized for their count at the target
false-positive rate. The ergonomic entry point when the key set is already
in hand; use [BloomFilter.create](#create) to size for a count known ahead.

#### Parameters

##### keys

`Iterable`\<`BytesLike`\>

The keys to insert.

##### epsilon

`number`

Target false-positive rate, e.g. `0.01` for 1%.

#### Returns

`BloomFilter`

A new filter containing every key.

---

### fromBytes()

> `static` **fromBytes**(`bytes`): `BloomFilter`

Defined in: [packages/distillate/src/bloom/bloom.ts:100](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/bloom/bloom.ts#L100)

Restores a filter from its [BloomFilter.toBytes](#tobytes) serialization.

#### Parameters

##### bytes

`Uint8Array`

The serialized filter.

#### Returns

`BloomFilter`

The reconstructed filter.

---

### fromJSON()

> `static` **fromJSON**(`value`): `BloomFilter`

Defined in: [packages/distillate/src/bloom/bloom.ts:234](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/bloom/bloom.ts#L234)

Restores a filter from its [BloomFilter.toJSON](#tojson) envelope.

#### Parameters

##### value

`unknown`

The JSON envelope.

#### Returns

`BloomFilter`

The reconstructed filter.
