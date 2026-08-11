[**distillate**](../../README.md)

---

[distillate](../../README.md) / [blocked](../README.md) / BlockedBloomFilter

# Class: BlockedBloomFilter

Defined in: [packages/distillate/src/blocked/blocked.ts:113](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/blocked/blocked.ts#L113)

A blocked (split-block) Bloom filter: confines every lookup to a single cache
line, trading ~15% more space for higher lookup throughput and a lower FPR.

## Example

```ts
const filter = BlockedBloomFilter.create(100_000, 0.01);
filter.add("alice");
filter.has("alice"); // true
```

## Constructors

### Constructor

> **new BlockedBloomFilter**(`__namedParameters`): `BlockedBloomFilter`

Defined in: [packages/distillate/src/blocked/blocked.ts:158](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/blocked/blocked.ts#L158)

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

Defined in: [packages/distillate/src/blocked/blocked.ts:187](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/blocked/blocked.ts#L187)

Actual bits allocated per key (`total bits / capacity`).

##### Returns

`number`

---

### length

#### Get Signature

> **get** **length**(): `number`

Defined in: [packages/distillate/src/blocked/blocked.ts:202](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/blocked/blocked.ts#L202)

Number of bits currently set across all lanes.

##### Returns

`number`

---

### numBlocks

#### Get Signature

> **get** **numBlocks**(): `number`

Defined in: [packages/distillate/src/blocked/blocked.ts:192](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/blocked/blocked.ts#L192)

Number of 256-bit blocks; one of the two fields `union` requires to match.

##### Returns

`number`

---

### seed

#### Get Signature

> **get** **seed**(): `number`

Defined in: [packages/distillate/src/blocked/blocked.ts:197](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/blocked/blocked.ts#L197)

Hash seed; the other field `union` requires to match.

##### Returns

`number`

## Methods

### add()

> **add**(`key`): `void`

Defined in: [packages/distillate/src/blocked/blocked.ts:336](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/blocked/blocked.ts#L336)

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

Defined in: [packages/distillate/src/blocked/blocked.ts:284](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/blocked/blocked.ts#L284)

Tests structural equality: `true` when `other` serializes to identical
bytes, meaning identical parameters and set bits.

#### Parameters

##### other

`BlockedBloomFilter`

The filter to compare against.

#### Returns

`boolean`

`true` if the two filters are byte-for-byte identical.

---

### has()

> **has**(`key`): `boolean`

Defined in: [packages/distillate/src/blocked/blocked.ts:350](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/blocked/blocked.ts#L350)

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

Defined in: [packages/distillate/src/blocked/blocked.ts:221](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/blocked/blocked.ts#L221)

Estimates the current false-positive rate from the actual fill,
`(length / totalBits) ** 8`. A split-block query checks exactly 8 lane-bits,
so the exponent is 8 rather than a classic probe count `k`. This reflects
how full the filter is right now, not the design target.

#### Returns

`number`

The estimated false-positive rate, `0` for an empty filter.

---

### toBytes()

> **toBytes**(): `Uint8Array`

Defined in: [packages/distillate/src/blocked/blocked.ts:259](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/blocked/blocked.ts#L259)

Serializes the filter to a portable little-endian byte layout.

#### Returns

`Uint8Array`

The serialized filter, readable by [BlockedBloomFilter.fromBytes](#frombytes).

---

### toJSON()

> **toJSON**(): [`FilterJSON`](../../bloom/interfaces/FilterJSON.md)

Defined in: [packages/distillate/src/blocked/blocked.ts:294](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/blocked/blocked.ts#L294)

Serializes the filter to a JSON-friendly envelope wrapping the base64 of
[BlockedBloomFilter.toBytes](#tobytes).

#### Returns

[`FilterJSON`](../../bloom/interfaces/FilterJSON.md)

The envelope, readable by [BlockedBloomFilter.fromJSON](#fromjson).

---

### union()

> **union**(`other`): `BlockedBloomFilter`

Defined in: [packages/distillate/src/blocked/blocked.ts:315](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/blocked/blocked.ts#L315)

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

---

### create()

> `static` **create**(`n`, `epsilon`): `BlockedBloomFilter`

Defined in: [packages/distillate/src/blocked/blocked.ts:128](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/blocked/blocked.ts#L128)

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

---

### from()

> `static` **from**(`keys`, `epsilon`): `BlockedBloomFilter`

Defined in: [packages/distillate/src/blocked/blocked.ts:147](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/blocked/blocked.ts#L147)

Builds a filter from `keys`, sized for their count at the target
false-positive rate. The ergonomic entry point when the key set is already
in hand; use [BlockedBloomFilter.create](#create) to size for a count known
ahead.

#### Parameters

##### keys

`Iterable`\<`BytesLike`\>

The keys to insert.

##### epsilon

`number`

Target false-positive rate, e.g. `0.01` for 1%.

#### Returns

`BlockedBloomFilter`

A new filter containing every key.

---

### fromBytes()

> `static` **fromBytes**(`bytes`): `BlockedBloomFilter`

Defined in: [packages/distillate/src/blocked/blocked.ts:231](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/blocked/blocked.ts#L231)

Restores a filter from its [BlockedBloomFilter.toBytes](#tobytes) serialization.

#### Parameters

##### bytes

`Uint8Array`

The serialized filter.

#### Returns

`BlockedBloomFilter`

The reconstructed filter.

---

### fromJSON()

> `static` **fromJSON**(`value`): `BlockedBloomFilter`

Defined in: [packages/distillate/src/blocked/blocked.ts:304](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/blocked/blocked.ts#L304)

Restores a filter from its [BlockedBloomFilter.toJSON](#tojson) envelope.

#### Parameters

##### value

`unknown`

The JSON envelope.

#### Returns

`BlockedBloomFilter`

The reconstructed filter.
