import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { build } from "esbuild";

// Imports in the measured code resolve from the bench package, so each
// library is the version the rest of the bench measures.
const BENCH_DIR = fileURLToPath(new URL("..", import.meta.url));

/**
 * What a browser bundle of `code` costs: esbuild's minified output, gzipped.
 * Measured rather than quoted, so a release of either library moves it.
 */
export async function bundleSize(code: string): Promise<number> {
  const result = await build({
    stdin: { contents: code, resolveDir: BENCH_DIR },
    bundle: true,
    minify: true,
    format: "esm",
    platform: "browser",
    write: false,
    logLevel: "silent",
  });
  return gzipSync(result.outputFiles[0]?.contents ?? new Uint8Array()).length;
}

export interface BundleRow {
  name: string;
  /** The sketch alone. */
  sketch: number;
  /** The sketch and what it takes to write Datadog's protobuf. */
  withProtobuf: number;
}

export async function ddSketchBundles(): Promise<BundleRow[]> {
  return [
    {
      name: "distillate/ddsketch",
      sketch: await bundleSize(
        'import { DDSketch } from "distillate/ddsketch"; globalThis.x = DDSketch;',
      ),
      withProtobuf: await bundleSize(
        'import { DDSketch } from "distillate/ddsketch"; import { toProtobuf } from "distillate/ddsketch/protobuf"; globalThis.x = [DDSketch, toProtobuf];',
      ),
    },
    {
      name: "@datadog/sketches-js",
      sketch: await bundleSize(
        'import { DDSketch } from "@datadog/sketches-js"; globalThis.x = DDSketch;',
      ),
      withProtobuf: await bundleSize(
        'import { DDSketch } from "@datadog/sketches-js"; globalThis.x = () => new DDSketch().toProto();',
      ),
    },
  ];
}

export interface LshBundleRow {
  name: string;
  /** The sketch alone. */
  sketch: number;
  /** The sketch and its LSH index; null where the library has none. */
  withLsh: number | null;
}

export async function minHashBundles(): Promise<LshBundleRow[]> {
  return [
    {
      name: "distillate/minhash",
      sketch: await bundleSize(
        'import { MinHash } from "distillate/minhash"; globalThis.x = MinHash;',
      ),
      withLsh: await bundleSize(
        'import { MinHash, MinHashLSH } from "distillate/minhash"; globalThis.x = [MinHash, MinHashLSH];',
      ),
    },
    {
      // Hashing comes too: its MinHash takes numbers, so strings need it.
      name: "bloom-filters",
      sketch: await bundleSize(
        'import { Hashing, MinHashFactory } from "bloom-filters"; globalThis.x = [Hashing, MinHashFactory];',
      ),
      withLsh: null,
    },
    {
      name: "minhash",
      sketch: await bundleSize(
        'import { Minhash } from "minhash"; globalThis.x = Minhash;',
      ),
      withLsh: await bundleSize(
        'import { Minhash, LshIndex } from "minhash"; globalThis.x = [Minhash, LshIndex];',
      ),
    },
  ];
}

export interface ReconcileBundleRow {
  name: string;
  bytes: number;
}

/** Everything a reconcile needs on both sides, as one import per library. */
export async function ribltBundles(): Promise<ReconcileBundleRow[]> {
  return [
    {
      name: "distillate/riblt",
      bytes: await bundleSize(
        'import { RibltDecoder, RibltEncoder } from "distillate/riblt"; globalThis.x = [RibltEncoder, RibltDecoder];',
      ),
    },
    {
      name: "ribbit-riblt",
      bytes: await bundleSize(
        'import { BloomDiff, BloomStream, deserializeCellBatch, serializeCellBatch } from "ribbit-riblt"; globalThis.x = [BloomStream, BloomDiff, serializeCellBatch, deserializeCellBatch];',
      ),
    },
    {
      name: "bloom-filters",
      bytes: await bundleSize(
        'import { InvertibleBloomFilter } from "bloom-filters"; globalThis.x = InvertibleBloomFilter;',
      ),
    },
  ];
}
