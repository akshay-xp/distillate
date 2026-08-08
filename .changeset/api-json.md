---
"distillate": minor
---

Add `toJSON`/`fromJSON` to all filters (Bloom, Blocked, Fuse 8/16). `toJSON()` returns a JSON-friendly envelope (`{ $, v, data }`) wrapping the base64 of `toBytes()`, so filters can live in a JSON column or survive `JSON.stringify`; `fromJSON` validates the envelope and delegates to `fromBytes`.
