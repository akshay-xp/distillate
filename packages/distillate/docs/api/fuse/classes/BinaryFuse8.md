[**distillate**](../../README.md)

---

[distillate](../../README.md) / [fuse](../README.md) / BinaryFuse8

# Class: BinaryFuse8

Defined in: [packages/distillate/src/fuse/fuse.ts:405](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/fuse/fuse.ts#L405)

A static 8-bit binary fuse filter: built once from a key set, then immutable.
The most space-efficient option (~9 bits/key at ~0.39% false-positive rate).

## Example

```ts
const filter = BinaryFuse8.from(["alice", "bob", "carol"]);
filter.has("alice"); // true
filter.size; // 3
```

## Extends

- `BinaryFuse`

## Constructors

### Constructor

> `protected` **new BinaryFuse8**(`state`): `BinaryFuse8`

Defined in: [packages/distillate/src/fuse/fuse.ts:292](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/fuse/fuse.ts#L292)

#### Parameters

##### state

`FuseState`

#### Returns

`BinaryFuse8`

#### Inherited from

`BinaryFuse.constructor`

## Accessors

### bitsPerKey

#### Get Signature

> **get** **bitsPerKey**(): `number`

Defined in: [packages/distillate/src/fuse/fuse.ts:312](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/fuse/fuse.ts#L312)

Actual bits stored per key (`0` for an empty filter).

##### Returns

`number`

#### Inherited from

`BinaryFuse.bitsPerKey`

---

### seed

#### Get Signature

> **get** **seed**(): `number`

Defined in: [packages/distillate/src/fuse/fuse.ts:307](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/fuse/fuse.ts#L307)

Hash seed selected during construction (may differ from 0 after a peel retry).

##### Returns

`number`

#### Inherited from

`BinaryFuse.seed`

---

### size

#### Get Signature

> **get** **size**(): `number`

Defined in: [packages/distillate/src/fuse/fuse.ts:302](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/fuse/fuse.ts#L302)

Number of distinct keys the filter was built from.

##### Returns

`number`

#### Inherited from

`BinaryFuse.size`

## Methods

### equals()

> **equals**(`other`): `boolean`

Defined in: [packages/distillate/src/fuse/fuse.ts:379](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/fuse/fuse.ts#L379)

Tests structural equality: `true` when `other` serializes to identical
bytes. A BinaryFuse8 and a [BinaryFuse16](BinaryFuse16.md) are never equal,
since their frames carry different type bytes.

#### Parameters

##### other

`BinaryFuse8` \| [`BinaryFuse16`](BinaryFuse16.md)

The filter to compare against.

#### Returns

`boolean`

`true` if the two filters are byte-for-byte identical.

#### Inherited from

`BinaryFuse.equals`

---

### has()

> **has**(`key`): `boolean`

Defined in: [packages/distillate/src/fuse/fuse.ts:347](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/fuse/fuse.ts#L347)

Tests whether a key is in the set.

#### Parameters

##### key

`BytesLike`

The key to test.

#### Returns

`boolean`

`true` if present (possibly a false positive); `false` guarantees absence.

#### Inherited from

`BinaryFuse.has`

---

### toBytes()

> **toBytes**(): `Uint8Array`

Defined in: [packages/distillate/src/fuse/fuse.ts:321](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/fuse/fuse.ts#L321)

Serializes the filter to a portable little-endian byte layout.

#### Returns

`Uint8Array`

The serialized filter, readable by the matching `fromBytes`.

#### Inherited from

`BinaryFuse.toBytes`

---

### toJSON()

> **toJSON**(): [`FilterJSON`](../../bloom/interfaces/FilterJSON.md)

Defined in: [packages/distillate/src/fuse/fuse.ts:389](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/fuse/fuse.ts#L389)

Serializes the filter to a JSON-friendly envelope wrapping the base64 of
the `toBytes` frame.

#### Returns

[`FilterJSON`](../../bloom/interfaces/FilterJSON.md)

The envelope, readable by the matching `fromJSON`.

#### Inherited from

`BinaryFuse.toJSON`

---

### from()

> `static` **from**(`keys`): `BinaryFuse8`

Defined in: [packages/distillate/src/fuse/fuse.ts:413](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/fuse/fuse.ts#L413)

Builds a filter from the given keys; duplicates are ignored.

#### Parameters

##### keys

`Iterable`\<`BytesLike`\>

The complete set of keys to store.

#### Returns

`BinaryFuse8`

A new immutable filter.

#### Throws

[BinaryFuseBuildError](BinaryFuseBuildError.md) if construction fails to converge.

---

### fromBytes()

> `static` **fromBytes**(`bytes`): `BinaryFuse8`

Defined in: [packages/distillate/src/fuse/fuse.ts:423](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/fuse/fuse.ts#L423)

Restores a filter from its [BinaryFuse8.toBytes](#tobytes) serialization.

#### Parameters

##### bytes

`Uint8Array`

The serialized filter.

#### Returns

`BinaryFuse8`

The reconstructed filter.

---

### fromJSON()

> `static` **fromJSON**(`value`): `BinaryFuse8`

Defined in: [packages/distillate/src/fuse/fuse.ts:433](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/fuse/fuse.ts#L433)

Restores a filter from its [BinaryFuse8.toJSON](#tojson) envelope.

#### Parameters

##### value

`unknown`

The JSON envelope.

#### Returns

`BinaryFuse8`

The reconstructed filter.
