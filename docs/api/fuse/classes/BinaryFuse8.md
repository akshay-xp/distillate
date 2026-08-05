[**distillate**](../../README.md)

***

[distillate](../../README.md) / [fuse](../README.md) / BinaryFuse8

# Class: BinaryFuse8

Defined in: [src/fuse/fuse.ts:407](https://github.com/akshay-xp/distillate/blob/main/src/fuse/fuse.ts#L407)

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

Defined in: [src/fuse/fuse.ts:324](https://github.com/akshay-xp/distillate/blob/main/src/fuse/fuse.ts#L324)

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

Defined in: [src/fuse/fuse.ts:339](https://github.com/akshay-xp/distillate/blob/main/src/fuse/fuse.ts#L339)

Actual bits stored per key (`0` for an empty filter).

##### Returns

`number`

#### Inherited from

`BinaryFuse.bitsPerKey`

***

### size

#### Get Signature

> **get** **size**(): `number`

Defined in: [src/fuse/fuse.ts:334](https://github.com/akshay-xp/distillate/blob/main/src/fuse/fuse.ts#L334)

Number of distinct keys the filter was built from.

##### Returns

`number`

#### Inherited from

`BinaryFuse.size`

## Methods

### has()

> **has**(`key`): `boolean`

Defined in: [src/fuse/fuse.ts:371](https://github.com/akshay-xp/distillate/blob/main/src/fuse/fuse.ts#L371)

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

***

### toBytes()

> **toBytes**(): `Uint8Array`

Defined in: [src/fuse/fuse.ts:348](https://github.com/akshay-xp/distillate/blob/main/src/fuse/fuse.ts#L348)

Serializes the filter to a portable little-endian byte layout.

#### Returns

`Uint8Array`

The serialized filter, readable by the matching `fromBytes`.

#### Inherited from

`BinaryFuse.toBytes`

***

### from()

> `static` **from**(`keys`): `BinaryFuse8`

Defined in: [src/fuse/fuse.ts:415](https://github.com/akshay-xp/distillate/blob/main/src/fuse/fuse.ts#L415)

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

***

### fromBytes()

> `static` **fromBytes**(`bytes`): `BinaryFuse8`

Defined in: [src/fuse/fuse.ts:425](https://github.com/akshay-xp/distillate/blob/main/src/fuse/fuse.ts#L425)

Restores a filter from its [BinaryFuse8.toBytes](#tobytes) serialization.

#### Parameters

##### bytes

`Uint8Array`

The serialized filter.

#### Returns

`BinaryFuse8`

The reconstructed filter.
