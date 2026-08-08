[**distillate**](../../README.md)

---

[distillate](../../README.md) / [bloom](../README.md) / FilterJSON

# Interface: FilterJSON

Defined in: [packages/distillate/src/core/serialize.ts:65](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/core/serialize.ts#L65)

JSON-friendly envelope for a filter: the binary frame, base64-encoded.

## Properties

### $

> **$**: `string`

Defined in: [packages/distillate/src/core/serialize.ts:67](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/core/serialize.ts#L67)

Format tag; always `"distillate"`.

---

### data

> **data**: `string`

Defined in: [packages/distillate/src/core/serialize.ts:71](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/core/serialize.ts#L71)

Base64 of the `toBytes` frame.

---

### v

> **v**: `number`

Defined in: [packages/distillate/src/core/serialize.ts:69](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/core/serialize.ts#L69)

Binary format version.
