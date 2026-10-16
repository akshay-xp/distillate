// Node 24.13 doesn't detect the named exports of bloom-filters, which is
// CommonJS, so they are read once here through its default export.
import bloomFilters from "bloom-filters";

export const {
  BloomFilter,
  CountMinSketch,
  CuckooFilter,
  Hashing,
  HyperLogLog,
  InvertibleBloomFilter,
  MinHashFactory,
  ScalableBloomFilter,
  TopK,
} = bloomFilters;
