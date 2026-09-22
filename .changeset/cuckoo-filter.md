---
"distillate": minor
---

Add `distillate/cuckoo` with `CuckooFilter`, a filter you can delete from. Each `delete` removes one copy of a key you added, an add into a full filter throws `CuckooFullError` and leaves the filter unchanged (no key is ever silently dropped), and it has the same `create`, `from`, `equals`, `rate()` and binary and JSON serialization (frame type 7) as the other filters. Like `BinaryFuse8.from`, `from` ignores duplicate keys, while `add` stores a copy each time. `cuckooSizing(n, epsilon)` returns its geometry. A saved filter loads with the geometry it was written with, so frames stay readable if the sizing is tuned in a later release.
