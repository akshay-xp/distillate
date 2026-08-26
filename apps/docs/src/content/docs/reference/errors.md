---
title: Errors
description: Every error class distillate exports, when it is thrown, and what to do about it.
---

distillate exports ten error classes. Each has a `name` that discriminates it
from a plain `Error`, so you can narrow with `instanceof` or switch on `name`.

They fall into three groups by cause: bad parameters, an operation two filters
cannot support, and a frame that will not decode.

| Error                                                                                    | Thrown by                                  | Cause                                   |
| ---------------------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------- |
| [`ParamError`](/api/bloom/classes/paramerror/)                                           | constructors, `create`, sizing             | A parameter is out of range             |
| [`BloomParamMismatchError`](/api/bloom/classes/bloomparammismatcherror/)                 | `BloomFilter.union`                        | Filters disagree on geometry            |
| [`BlockedBloomParamMismatchError`](/api/blocked/classes/blockedbloomparammismatcherror/) | `BlockedBloomFilter.union`                 | Filters disagree on geometry            |
| [`BinaryFuseBuildError`](/api/fuse/classes/binaryfusebuilderror/)                        | `BinaryFuse8.from`, `BinaryFuse16.from`    | The peel stalled on every seed          |
| [`SerializationError`](/api/bloom/classes/serializationerror/)                           | `fromJSON`, and the base of the five below | The envelope is malformed               |
| [`TruncatedError`](/api/bloom/classes/truncatederror/)                                   | `fromBytes`                                | The frame is short                      |
| [`BadMagicError`](/api/bloom/classes/badmagicerror/)                                     | `fromBytes`                                | Not a DSTL frame                        |
| [`UnknownVersionError`](/api/bloom/classes/unknownversionerror/)                         | `fromBytes`, `fromJSON`                    | A format version this build cannot read |
| [`UnknownHashVariantError`](/api/bloom/classes/unknownhashvarianterror/)                 | `fromBytes`                                | A hash this build cannot reproduce      |
| [`ChecksumError`](/api/bloom/classes/checksumerror/)                                     | `fromBytes`                                | CRC32 does not match                    |

The six serialization errors are exported from all three subpaths. The rest
are exported from the subpath of the structure that throws them, except
`ParamError`, which is exported from `distillate/bloom` and
`distillate/blocked`.

## Parameter errors

### `ParamError`

[API reference](/api/bloom/classes/paramerror/). Extends `RangeError`.

**Thrown when** a structure is constructed or sized with a parameter outside
its valid range. Specifically:

- `n`, `m`, `k`, or `capacity` is not an integer of at least 1.
- `epsilon` is not a finite number strictly between 0 and 1.
- `seed` is outside the uint32 range, or `k` outside uint16.
- `blockedBitsPerKey(epsilon)` or `BlockedBloomFilter.create` is asked for a
  rate below the blocked floor near 1e-8.

**What to do:** this is a programming error, not a runtime condition. The
message names the offending parameter and its value. Validate at your own
boundary if the value comes from configuration or user input.

```ts
import { BloomFilter, ParamError } from "distillate/bloom";

try {
  BloomFilter.create(1000, 1.5); // epsilon must be in (0, 1)
} catch (error) {
  if (error instanceof ParamError) {
    error.name; // "ParamError"
    error.message; // "epsilon must be in the open interval (0, 1), got 1.5"
  }
}
```

For the blocked floor specifically, the fix is a different structure rather
than a different number. See [sizing and tuning](/guides/sizing/).

## Merge errors

Both `union` implementations require the two filters to be structurally
identical. They do not silently reshape.

### `BloomParamMismatchError`

[API reference](/api/bloom/classes/bloomparammismatcherror/).

**Thrown when** `BloomFilter.union` is given a filter whose `m`, `k`, or
`seed` differs from the receiver's.

**What to do:** build both sides with the same parameters. Passing the same
`n` and `epsilon` to `create` is enough, since the geometry is a pure function
of those two. If you construct directly, share one `BloomParams` object.

```ts
import { BloomFilter, BloomParamMismatchError } from "distillate/bloom";

const a = BloomFilter.create(1000, 0.01);
const b = BloomFilter.create(2000, 0.01); // different capacity, different m

try {
  a.union(b);
} catch (error) {
  if (error instanceof BloomParamMismatchError) {
    // Rebuild b at a's capacity, or merge from the source keys instead.
  }
}
```

### `BlockedBloomParamMismatchError`

[API reference](/api/blocked/classes/blockedbloomparammismatcherror/).

**Thrown when** `BlockedBloomFilter.union` is given a filter whose `numBlocks`
or `seed` differs from the receiver's.

**What to do:** the same. Size both sides identically. Note the check is on
`numBlocks`, not on the `bitsPerKey` you asked for, so two filters created
with different capacities can still round to the same block count and merge
fine.

```ts
import {
  BlockedBloomFilter,
  BlockedBloomParamMismatchError,
} from "distillate/blocked";

const a = BlockedBloomFilter.create(1000, 0.01);
const b = BlockedBloomFilter.create(100_000, 0.01);

try {
  a.union(b);
} catch (error) {
  error instanceof BlockedBloomParamMismatchError; // true
}
```

## Build errors

### `BinaryFuseBuildError`

[API reference](/api/fuse/classes/binaryfusebuilderror/).

**Thrown when** the Binary Fuse peel fails on all 100 seeds it tries. The
build hashes the keys, then peels a 3-hypergraph; a peel can stall, so it
retries with a bumped seed rather than returning a corrupt filter.

**What to do:** in practice, nothing, because you will not see this. The
probability of 100 consecutive stalls is astronomically small for any real key
set. If it does happen, treat it as a bug report rather than something to
retry, and include the key count. The one thing it guarantees is that you
never receive a filter that would produce false negatives.

```ts
import { BinaryFuse8, BinaryFuseBuildError } from "distillate/fuse";

try {
  const filter = BinaryFuse8.from(["alice", "bob", "carol"]);
  filter.has("alice"); // true
} catch (error) {
  if (error instanceof BinaryFuseBuildError) {
    // Astronomically unlikely, and never a silently wrong filter.
  }
}
```

## Serialization errors

Five specific errors, all extending `SerializationError`. Catch the base class
to handle any decode failure at once, or a subclass to tell the causes apart.

```ts
import { BloomFilter, SerializationError } from "distillate/bloom";

function load(bytes: Uint8Array): BloomFilter | null {
  try {
    return BloomFilter.fromBytes(bytes);
  } catch (error) {
    if (error instanceof SerializationError) return null; // rebuild instead
    throw error;
  }
}
```

None of them are retryable. The same bytes fail the same way every time, so
the recovery is always to get different bytes or to rebuild from the source
keys.

### `SerializationError`

[API reference](/api/bloom/classes/serializationerror/).

**Thrown directly when** a JSON envelope is malformed: not an object, missing
the `"distillate"` tag, missing a string `data` field, or `data` that is not
valid base64. It is also the base class of the five below.

**What to do:** check that you passed the object `toJSON` produced, and that
it survived whatever transport carried it. An envelope that has been through a
schema mapper or had its keys renamed will fail here.

### `TruncatedError`

[API reference](/api/bloom/classes/truncatederror/).

**Thrown when** a frame is shorter than its 8-byte header plus 4-byte trailer,
or when the body length does not match what its declared params imply.

**What to do:** the bytes were cut short in transit or storage. Re-fetch the
whole frame. This check runs before any allocation, so a hostile length field
cannot make the reader allocate.

### `BadMagicError`

[API reference](/api/bloom/classes/badmagicerror/).

**Thrown when** a frame does not start with the four-byte `DSTL` magic, so it
was never produced by `toBytes`. Frames written before format version 4 carry
the older `AMQF` magic and land here rather than on the version check.

**What to do:** check what you are actually handing it. Common causes are a
pre-v4 distillate frame (re-serialize it with the version you run), a frame
from another library (a `bloom-filters` dump lands here), a base64 string that
was never decoded, or a `Uint8Array` sliced at the wrong offset.
`fromBytes` respects `byteOffset` and `byteLength`, so a correct subarray view
is fine; an incorrect one is not.

### `UnknownVersionError`

[API reference](/api/bloom/classes/unknownversionerror/).

**Thrown when** a frame's version byte, or a JSON envelope's `v` field, is not
the `FORMAT_VERSION` this build reads. That is `4` today.

**What to do:** upgrade `distillate` on the reading side, or re-serialize the
data with the version you run. A reader must be at least as new as the
producer: the version check protects a newer reader from an older frame, and
cannot protect an older reader from a newer one. If you build filters in one
service and read them in another, upgrade the readers first. See
[serialization](/reference/serialization/) and
[versioning](/reference/versioning/).

### `UnknownHashVariantError`

[API reference](/api/bloom/classes/unknownhashvarianterror/).

**Thrown when** the low nibble of a frame's flags byte names a hash this build
cannot reproduce. Version 4 defines exactly one variant, `0`, which is
murmur3_x86_128 for every structure.

**What to do:** rebuild the filter from the source keys with the version you
run. The stored bits are unreadable without the hash that produced them, so
there is nothing to recover from the frame itself.

### `ChecksumError`

[API reference](/api/bloom/classes/checksumerror/).

**Thrown when** a frame's CRC32 trailer does not match its contents. The
header and params parsed, so this is corruption in the bytes rather than a
foreign format.

**What to do:** discard the bytes and re-fetch. Do not use the filter anyway:
a corrupted payload can produce false negatives, which is the one guarantee a
filter is supposed to keep. Check the storage or transport path, since a CRC
mismatch means something wrote or copied the frame incorrectly.
