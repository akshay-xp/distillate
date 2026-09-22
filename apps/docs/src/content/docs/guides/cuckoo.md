---
title: Cuckoo
description: A membership filter you can delete from. Short fingerprints in buckets of four, each key in one of two buckets, and an add into a full filter that refuses rather than corrupts.
---

`distillate/cuckoo` ships the cuckoo filter of Fan, Andersen, Kaminsky and
Mitzenmacher (2014): a table of short fingerprints, four to a bucket, where each
key lives in one of two candidate buckets. Because it stores a fingerprint per
key rather than setting shared bits, it can take one back out.

- **Mutable**, with `add` and `delete`.
- **No false negatives** for any key added and not deleted.
- **Refuses rather than corrupts** when it is full.

Fan, Andersen, Kaminsky and Mitzenmacher, "Cuckoo Filter: Practically Better
Than Bloom", 2014.

## Build one

```ts
import { CuckooFilter } from "distillate/cuckoo";

const sessions = CuckooFilter.create(1000, 0.01); // expected keys, target FPR

sessions.add("alice");
sessions.has("alice"); // true
sessions.has("bob"); // false

sessions.delete("alice"); // true
sessions.has("alice"); // false
```

`create(n, epsilon)` sizes the table for `n` keys at a false-positive target of
`epsilon`. To build from a key set you already hold, `from(keys, epsilon)` sizes
for their count and adds them.

## When to pick it

Pick it when keys leave the set as well as join it: sessions that expire,
revoked tokens, a cache's evicted keys. It is the one filter in the library with
`delete`. Every Bloom variant, `BloomFilter` included, sets bits that other keys
share, so clearing them would lose those keys; with a Bloom filter the only way
to remove a key is to rebuild from the keys that remain.

If nothing is ever removed, a Bloom filter is the simpler choice, and at common
targets a smaller one (see [Space](#space)).

## Delete

Every `add` stores a fingerprint, even for a key the filter already holds, and
every `delete` removes one. A key added twice needs two deletes:

```ts
import { CuckooFilter } from "distillate/cuckoo";

const f = CuckooFilter.create(1000, 0.01);
f.add("alice");
f.add("alice");

f.delete("alice"); // true
f.has("alice"); // true
f.delete("alice"); // true
f.has("alice"); // false
f.delete("alice"); // false
```

This is how every mainstream cuckoo filter behaves. Removing all copies at once
would be wrong, because two different keys can share a fingerprint and bucket:
one delete would then take out a key that is still meant to be there.

## Only delete what you added

The filter stores fingerprints, not keys, so it cannot tell a key it holds
from a different key that happens to share its fingerprint and bucket. Delete a
key that was never added, and on that rare match it removes the other key's
fingerprint instead. That key then reads as absent: a false negative, the one
answer a filter is supposed to never give.

So `delete` is only for keys you added and have not already deleted. If you are
not sure a key is in the set, check your source of truth first, not `has`, since
`has` answers `true` for false positives too.

## When it is full

When both of a key's buckets are full, `add` moves a resident fingerprint to its
other bucket, then that one's displaced resident, and so on, up to 500 moves.
If that still finds no room, it undoes every move and throws `CuckooFullError`,
leaving the filter unchanged: every key it held is still there.

```ts
import { CuckooFilter, CuckooFullError } from "distillate/cuckoo";

const f = CuckooFilter.create(1, 0.01); // room for a handful of keys
let error: unknown;
for (let i = 0; i < 20 && error === undefined; i++) {
  try {
    f.add(`key-${String(i)}`);
  } catch (e) {
    error = e;
  }
}
error instanceof CuckooFullError; // true
f.has("key-0"); // true
```

A filter sized for `n` takes `n` keys, so a full filter means more keys than
planned. Size for more, or delete keys you no longer need before adding.

## Space

A cuckoo filter spends about `log2(1 / epsilon) + 3` bits per key at 95% load,
against Bloom's `1.44 * log2(1 / epsilon)`. The constant costs it at common
targets, and the slope wins it back at strict ones:

```ts
import { BloomFilter } from "distillate/bloom";
import { CuckooFilter } from "distillate/cuckoo";

CuckooFilter.create(100_000, 0.01).bitsPerKey; // ~10.65
BloomFilter.create(100_000, 0.01).bitsPerKey; // ~9.59
CuckooFilter.create(100_000, 0.001).bitsPerKey; // ~13.85
BloomFilter.create(100_000, 0.001).bitsPerKey; // ~14.38
```

It is smaller than a `BloomFilter` only at about 0.2% and below. The fingerprint
width is a whole number of bits, rounded up from the target, so the rate you get
is usually well under the one you asked for: about 0.74% at a 1% target.

## Persist it

`toBytes` and `fromBytes` round-trip through the portable binary format, and
`toJSON` and `fromJSON` wrap the same frame in JSON.

```ts
import { CuckooFilter } from "distillate/cuckoo";

const f = CuckooFilter.create(1000, 0.01);
f.add("alice");
f.add("bob");
f.delete("bob");

const restored = CuckooFilter.fromBytes(f.toBytes());
restored.equals(f); // true
restored.count; // 1
```

Which slot a key lands in depends on the order keys arrived, so two filters
given the same keys in a different order can be unequal. The frame layout is in
the [serialization reference](/reference/serialization/).
