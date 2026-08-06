---
"distillate": patch
---

Compute the serialization CRC-32 with a slice-by-8 table drive instead of the byte-at-a-time loop. Output is byte-identical (same IEEE 802.3 checksum), so no format change; `toBytes`/`fromBytes` are about 4x faster on large filters (measured ~50 ms to ~13 ms for the CRC over an 11 MB payload on Apple M5).
