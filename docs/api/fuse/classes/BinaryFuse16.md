[**distillate**](../../README.md)

***

[distillate](../../README.md) / [fuse](../README.md) / BinaryFuse16

# Class: BinaryFuse16

Defined in: [src/fuse/fuse.ts:410](https://github.com/akshay-xp/distillate/blob/main/src/fuse/fuse.ts#L410)

A static 16-bit binary fuse filter: like [BinaryFuse8](BinaryFuse8.md) but twice the
space (~18 bits/key) for a far lower false-positive rate (~1/65536).

## Example

```ts
const filter = BinaryFuse16.from(["alice", "bob", "carol"]);
filter.has("alice"); // true
```

## Extends

- `BinaryFuse`

## Constructors

### Constructor

> `protected` **new BinaryFuse16**(`state`): `BinaryFuse16`

Defined in: [src/fuse/fuse.ts:279](https://github.com/akshay-xp/distillate/blob/main/src/fuse/fuse.ts#L279)

#### Parameters

##### state

`FuseState`

#### Returns

`BinaryFuse16`

#### Inherited from

`BinaryFuse.constructor`

## Accessors

### bitsPerKey

#### Get Signature

> **get** **bitsPerKey**(): `number`

Defined in: [src/fuse/fuse.ts:294](https://github.com/akshay-xp/distillate/blob/main/src/fuse/fuse.ts#L294)

Actual bits stored per key (`0` for an empty filter).

##### Returns

`number`

#### Inherited from

`BinaryFuse.bitsPerKey`

***

### size

#### Get Signature

> **get** **size**(): `number`

Defined in: [src/fuse/fuse.ts:289](https://github.com/akshay-xp/distillate/blob/main/src/fuse/fuse.ts#L289)

Number of distinct keys the filter was built from.

##### Returns

`number`

#### Inherited from

`BinaryFuse.size`

## Methods

### equals()

> **equals**(`other`): `boolean`

Defined in: [src/fuse/fuse.ts:361](https://github.com/akshay-xp/distillate/blob/main/src/fuse/fuse.ts#L361)

Tests structural equality: `true` when `other` serializes to identical
bytes. A [BinaryFuse8](BinaryFuse8.md) and a BinaryFuse16 are never equal,
since their frames carry different type bytes.

#### Parameters

##### other

[`BinaryFuse8`](BinaryFuse8.md) \| `BinaryFuse16`

The filter to compare against.

#### Returns

`boolean`

`true` if the two filters are byte-for-byte identical.

#### Inherited from

`BinaryFuse.equals`

***

### has()

> **has**(`key`): `boolean`

Defined in: [src/fuse/fuse.ts:329](https://github.com/akshay-xp/distillate/blob/main/src/fuse/fuse.ts#L329)

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

Defined in: [src/fuse/fuse.ts:303](https://github.com/akshay-xp/distillate/blob/main/src/fuse/fuse.ts#L303)

Serializes the filter to a portable little-endian byte layout.

#### Returns

`Uint8Array`

The serialized filter, readable by the matching `fromBytes`.

#### Inherited from

`BinaryFuse.toBytes`

***

### from()

> `static` **from**(`keys`): `BinaryFuse16`

Defined in: [src/fuse/fuse.ts:418](https://github.com/akshay-xp/distillate/blob/main/src/fuse/fuse.ts#L418)

Builds a filter from the given keys; duplicates are ignored.

#### Parameters

##### keys

`Iterable`\<`BytesLike`\>

The complete set of keys to store.

#### Returns

`BinaryFuse16`

A new immutable filter.

#### Throws

[BinaryFuseBuildError](BinaryFuseBuildError.md) if construction fails to converge.

***

### fromBytes()

> `static` **fromBytes**(`bytes`): `BinaryFuse16`

Defined in: [src/fuse/fuse.ts:428](https://github.com/akshay-xp/distillate/blob/main/src/fuse/fuse.ts#L428)

Restores a filter from its [BinaryFuse16.toBytes](BinaryFuse8.md#tobytes) serialization.

#### Parameters

##### bytes

`Uint8Array`

The serialized filter.

#### Returns

`BinaryFuse16`

The reconstructed filter.
