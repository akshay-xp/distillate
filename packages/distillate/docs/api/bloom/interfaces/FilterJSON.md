[**distillate**](../../README.md)

---

[distillate](../../README.md) / [bloom](../README.md) / FilterJSON

# Interface: FilterJSON

Defined in: [packages/distillate/src/core/serialize.ts:84](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/core/serialize.ts#L84)

JSON-friendly envelope for a filter: the binary frame, base64-encoded.

## Properties

### $

> **$**: `string`

Defined in: [packages/distillate/src/core/serialize.ts:86](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/core/serialize.ts#L86)

Format tag; always `"distillate"`.

---

### data

> **data**: `string`

Defined in: [packages/distillate/src/core/serialize.ts:90](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/core/serialize.ts#L90)

Base64 of the `toBytes` frame.

---

### v

> **v**: `number`

Defined in: [packages/distillate/src/core/serialize.ts:88](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/core/serialize.ts#L88)

Binary format version.
