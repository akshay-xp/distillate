[**distillate**](../../README.md)

---

[distillate](../../README.md) / [fuse](../README.md) / BinaryFuse8

# Class: BinaryFuse8

Defined in: [packages/distillate/src/fuse/fuse.ts:390](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/fuse/fuse.ts#L390)

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

Defined in: [packages/distillate/src/fuse/fuse.ts:282](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/fuse/fuse.ts#L282)

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

Defined in: [packages/distillate/src/fuse/fuse.ts:297](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/fuse/fuse.ts#L297)

Actual bits stored per key (`0` for an empty filter).

##### Returns

`number`

#### Inherited from

`BinaryFuse.bitsPerKey`

---

### size

#### Get Signature

> **get** **size**(): `number`

Defined in: [packages/distillate/src/fuse/fuse.ts:292](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/fuse/fuse.ts#L292)

Number of distinct keys the filter was built from.

##### Returns

`number`

#### Inherited from

`BinaryFuse.size`

## Methods

### equals()

> **equals**(`other`): `boolean`

Defined in: [packages/distillate/src/fuse/fuse.ts:364](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/fuse/fuse.ts#L364)

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

Defined in: [packages/distillate/src/fuse/fuse.ts:332](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/fuse/fuse.ts#L332)

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

Defined in: [packages/distillate/src/fuse/fuse.ts:306](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/fuse/fuse.ts#L306)

Serializes the filter to a portable little-endian byte layout.

#### Returns

`Uint8Array`

The serialized filter, readable by the matching `fromBytes`.

#### Inherited from

`BinaryFuse.toBytes`

---

### toJSON()

> **toJSON**(): [`FilterJSON`](../../bloom/interfaces/FilterJSON.md)

Defined in: [packages/distillate/src/fuse/fuse.ts:374](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/fuse/fuse.ts#L374)

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

Defined in: [packages/distillate/src/fuse/fuse.ts:398](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/fuse/fuse.ts#L398)

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

Defined in: [packages/distillate/src/fuse/fuse.ts:408](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/fuse/fuse.ts#L408)

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

Defined in: [packages/distillate/src/fuse/fuse.ts:418](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/fuse/fuse.ts#L418)

Restores a filter from its [BinaryFuse8.toJSON](#tojson) envelope.

#### Parameters

##### value

`unknown`

The JSON envelope.

#### Returns

`BinaryFuse8`

The reconstructed filter.
