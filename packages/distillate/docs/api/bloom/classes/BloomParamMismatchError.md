[**distillate**](../../README.md)

---

[distillate](../../README.md) / [bloom](../README.md) / BloomParamMismatchError

# Class: BloomParamMismatchError

Defined in: [packages/distillate/src/bloom/bloom.ts:28](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/bloom/bloom.ts#L28)

Thrown when an operation requires two filters built with identical parameters.

## Extends

- `Error`

## Constructors

### Constructor

> **new BloomParamMismatchError**(`message?`): `BloomParamMismatchError`

Defined in: node\_modules/.pnpm/typescript@5.9.3/node\_modules/typescript/lib/lib.es5.d.ts:1082

#### Parameters

##### message?

`string`

#### Returns

`BloomParamMismatchError`

#### Inherited from

`Error.constructor`

### Constructor

> **new BloomParamMismatchError**(`message?`, `options?`): `BloomParamMismatchError`

Defined in: node\_modules/.pnpm/typescript@5.9.3/node\_modules/typescript/lib/lib.es5.d.ts:1082

#### Parameters

##### message?

`string`

##### options?

`ErrorOptions`

#### Returns

`BloomParamMismatchError`

#### Inherited from

`Error.constructor`

## Properties

### cause?

> `optional` **cause?**: `unknown`

Defined in: node\_modules/.pnpm/typescript@5.9.3/node\_modules/typescript/lib/lib.es2022.error.d.ts:26

#### Inherited from

`Error.cause`

---

### message

> **message**: `string`

Defined in: node\_modules/.pnpm/typescript@5.9.3/node\_modules/typescript/lib/lib.es5.d.ts:1077

#### Inherited from

`Error.message`

---

### name

> `readonly` **name**: `"BloomParamMismatchError"` = `"BloomParamMismatchError"`

Defined in: [packages/distillate/src/bloom/bloom.ts:30](https://github.com/akshay-xp/distillate/blob/main/packages/distillate/src/bloom/bloom.ts#L30)

Discriminates this error from other `Error`s.

#### Overrides

`Error.name`

---

### stack?

> `optional` **stack?**: `string`

Defined in: node\_modules/.pnpm/typescript@5.9.3/node\_modules/typescript/lib/lib.es5.d.ts:1078

#### Inherited from

`Error.stack`
