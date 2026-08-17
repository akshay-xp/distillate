[**distillate**](../../README.md)

---

[distillate](../../README.md) / [fuse](../README.md) / BinaryFuse16

# Class: BinaryFuse16

Defined in: [packages/distillate/src/fuse/fuse.ts:462](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/fuse/fuse.ts#L462)

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

Defined in: [packages/distillate/src/fuse/fuse.ts:306](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/fuse/fuse.ts#L306)

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

Defined in: [packages/distillate/src/fuse/fuse.ts:326](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/fuse/fuse.ts#L326)

Actual bits stored per key (`0` for an empty filter).

##### Returns

`number`

#### Inherited from

`BinaryFuse.bitsPerKey`

---

### seed

#### Get Signature

> **get** **seed**(): `number`

Defined in: [packages/distillate/src/fuse/fuse.ts:321](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/fuse/fuse.ts#L321)

Hash seed selected during construction (may differ from 0 after a peel retry).

##### Returns

`number`

#### Inherited from

`BinaryFuse.seed`

---

### size

#### Get Signature

> **get** **size**(): `number`

Defined in: [packages/distillate/src/fuse/fuse.ts:316](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/fuse/fuse.ts#L316)

Number of distinct keys the filter was built from.

##### Returns

`number`

#### Inherited from

`BinaryFuse.size`

## Methods

### equals()

> **equals**(`other`): `boolean`

Defined in: [packages/distillate/src/fuse/fuse.ts:393](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/fuse/fuse.ts#L393)

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

---

### has()

> **has**(`key`): `boolean`

Defined in: [packages/distillate/src/fuse/fuse.ts:361](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/fuse/fuse.ts#L361)

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

Defined in: [packages/distillate/src/fuse/fuse.ts:335](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/fuse/fuse.ts#L335)

Serializes the filter to a portable little-endian byte layout.

#### Returns

`Uint8Array`

The serialized filter, readable by the matching `fromBytes`.

#### Inherited from

`BinaryFuse.toBytes`

---

### toJSON()

> **toJSON**(): [`FilterJSON`](../../bloom/interfaces/FilterJSON.md)

Defined in: [packages/distillate/src/fuse/fuse.ts:403](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/fuse/fuse.ts#L403)

Serializes the filter to a JSON-friendly envelope wrapping the base64 of
the `toBytes` frame.

#### Returns

[`FilterJSON`](../../bloom/interfaces/FilterJSON.md)

The envelope, readable by the matching `fromJSON`.

#### Inherited from

`BinaryFuse.toJSON`

---

### from()

> `static` **from**(`keys`): `BinaryFuse16`

Defined in: [packages/distillate/src/fuse/fuse.ts:470](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/fuse/fuse.ts#L470)

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

---

### fromBytes()

> `static` **fromBytes**(`bytes`): `BinaryFuse16`

Defined in: [packages/distillate/src/fuse/fuse.ts:480](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/fuse/fuse.ts#L480)

Restores a filter from its [BinaryFuse16.toBytes](BinaryFuse8.md#tobytes) serialization.

#### Parameters

##### bytes

`Uint8Array`

The serialized filter.

#### Returns

`BinaryFuse16`

The reconstructed filter.

---

### fromJSON()

> `static` **fromJSON**(`value`): `BinaryFuse16`

Defined in: [packages/distillate/src/fuse/fuse.ts:490](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/fuse/fuse.ts#L490)

Restores a filter from its [BinaryFuse16.toJSON](BinaryFuse8.md#tojson) envelope.

#### Parameters

##### value

`unknown`

The JSON envelope.

#### Returns

`BinaryFuse16`

The reconstructed filter.
