---
"distillate": patch
---

`DDSketch.fromBytes` rejects a frame whose `indexOffset` is `-0`, a second encoding of offset 0 that decoded and then re-encoded differently. `fromProtobuf` reads a `-0` offset as 0, so a decoded sketch never writes one.
