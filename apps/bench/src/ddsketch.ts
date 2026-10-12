import { DDSketch as DatadogSketch } from "@datadog/sketches-js";
import { DDSketch, logMapping } from "distillate/ddsketch";
import { fromProtobuf, toProtobuf } from "distillate/ddsketch/protobuf";

import { rng } from "./countmin.js";
import { median } from "./keylength.js";

export interface QuantileSketch {
  /** The accuracy the sketch reports it was built for. */
  relativeAccuracy: number;
  add(value: number): void;
  quantile(q: number): number;
  /** Bytes in the library's own serialization. */
  bytes(): number;
  /** Bytes as Datadog's DDSketch protobuf message. */
  protoBytes(): number;
  /** A new sketch holding this one and `other`, both left as they were. */
  union(other: QuantileSketch): void;
  /** Datadog's DDSketch protobuf message. */
  toProto(): Uint8Array;
}

export interface DDSketchAdapter {
  name: string;
  create(relativeAccuracy: number): QuantileSketch;
  /** Decodes a message `toProto` wrote. */
  fromProto(bytes: Uint8Array): void;
}

// Each wrapper's library sketch, so union can reach the other operand's.
const raw = new WeakMap<QuantileSketch, unknown>();

/** The accuracy both sketches are built at: Datadog's own default. */
export const DDSKETCH_ACCURACY = 0.01;

/** Values per run, as for Top-K. */
export const DDSKETCH_EVENT_COUNTS = [1_000, 10_000, 100_000, 1_000_000];

/**
 * Untimed passes before the timed ones, and timed passes per row. One pass in
 * a fresh process measures how fast V8 tiers each library up rather than how
 * fast it adds: at 10k values the two read 35% apart cold and 1% apart warm.
 */
export const DDSKETCH_WARM_PASSES = 2;
export const DDSKETCH_TIMED_PASSES = 5;

/** Every quantile the error is measured at, the ends included. */
const QS = [0, 0.001, 0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99, 0.999, 1];

function distillateAdapter(
  name: string,
  options: Parameters<typeof DDSketch.create>[1],
): DDSketchAdapter {
  return {
    name,
    create(relativeAccuracy) {
      const s = DDSketch.create(relativeAccuracy, options);
      const wrapped: QuantileSketch = {
        relativeAccuracy: s.relativeAccuracy,
        add: (v) => {
          s.add(v);
        },
        quantile: (q) => s.quantile(q),
        bytes: () => s.toBytes().length,
        protoBytes: () => toProtobuf(s).length,
        union: (other) => {
          s.union(raw.get(other) as DDSketch);
        },
        toProto: () => toProtobuf(s),
      };
      raw.set(wrapped, s);
      return wrapped;
    },
    fromProto: (bytes) => {
      fromProtobuf(bytes);
    },
  };
}

/**
 * At defaults: the bitwise mapping and a store collapsing the lowest bins at
 * 4096, which the stream never reaches at 0.01.
 */
export const distillateDDSketchAdapter = distillateAdapter(
  "distillate/ddsketch",
  {},
);

/**
 * On the log mapping, sketches-js's default, so the two hold the same bins
 * and the comparison is like for like.
 */
export const distillateLogDDSketchAdapter = distillateAdapter(
  "distillate/ddsketch (log)",
  { mapping: logMapping },
);

/** At defaults: the log mapping and an unbounded dense store. */
export const datadogDDSketchAdapter: DDSketchAdapter = {
  name: "@datadog/sketches-js",
  create(relativeAccuracy) {
    const s = new DatadogSketch({ relativeAccuracy });
    const wrapped: QuantileSketch = {
      relativeAccuracy: s.mapping.relativeAccuracy,
      add: (v) => {
        s.accept(v);
      },
      quantile: (q) => s.getValueAtQuantile(q),
      // Its only serialization is the protobuf message.
      bytes: () => s.toProto().length,
      protoBytes: () => s.toProto().length,
      // Its merge folds into the receiver, so a fresh one takes both, as
      // distillate's union returns a new sketch.
      union: (other) => {
        const merged = new DatadogSketch({ relativeAccuracy });
        merged.merge(s);
        merged.merge(raw.get(other) as DatadogSketch);
      },
      toProto: () => s.toProto(),
    };
    raw.set(wrapped, s);
    return wrapped;
  },
  fromProto: (bytes) => {
    DatadogSketch.fromProto(bytes);
  },
};

export const ddSketchAdapters: DDSketchAdapter[] = [
  distillateDDSketchAdapter,
  distillateLogDDSketchAdapter,
  datadogDDSketchAdapter,
];

/**
 * `n` lognormal values around 100, the shape latencies in milliseconds take: a
 * long right tail, which is where a relative bound earns its keep.
 */
export function lognormalStream(seed: number, n: number): number[] {
  const next = rng(seed);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const z =
      Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next());
    out[i] = 100 * Math.exp(z);
  }
  return out;
}

export interface DDSketchRow {
  name: string;
  events: number;
  /** The largest relative error over QS, against the exact value at each. */
  maxRelError: number;
  bytes: number;
  protoBytes: number;
  addOpsPerSec: number;
  /** Over QS, on the sketch the timed adds built. */
  quantileOpsPerSec: number;
  /** With a second sketch of as many values from another stream. */
  unionOpsPerSec: number;
  toProtoOpsPerSec: number;
  fromProtoOpsPerSec: number;
}

// Calls per timed pass of the read-side operations: enough that a pass of the
// cheapest outlasts the timer's resolution.
const QUANTILE_CALLS = 10_000;
const CODEC_CALLS = 50;

// Calls per second of `fn`, as add is timed: the median of timed passes of
// `calls` calls, after untimed ones.
function rateOf(fn: (i: number) => void, calls: number): number {
  const pass = (): number => {
    const started = performance.now();
    for (let i = 0; i < calls; i++) fn(i);
    return performance.now() - started;
  };
  for (let p = 0; p < DDSKETCH_WARM_PASSES; p++) pass();
  const ms = median(Array.from({ length: DDSKETCH_TIMED_PASSES }, pass));
  return calls / (ms / 1000);
}

export function ddSketchRows(
  eventCounts: number[],
  adapters: DDSketchAdapter[] = ddSketchAdapters,
): DDSketchRow[] {
  const rows: DDSketchRow[] = [];
  for (const events of eventCounts) {
    // One stream per count, shared by both libraries, so both are scored
    // against the same exact quantiles: the value at rank floor(q * (n - 1)).
    const stream = lognormalStream(29, events);
    const second = lognormalStream(30, events);
    const sorted = [...stream].sort((a, b) => a - b);
    const exact = QS.map((q) => sorted[Math.floor(q * (events - 1))] ?? 0);

    for (const adapter of adapters) {
      // A fresh sketch every pass, so each times the same work from empty.
      const pass = (): { s: QuantileSketch; ms: number } => {
        const s = adapter.create(DDSKETCH_ACCURACY);
        const started = performance.now();
        for (const v of stream) s.add(v);
        return { s, ms: performance.now() - started };
      };
      for (let p = 0; p < DDSKETCH_WARM_PASSES; p++) pass();
      const timed = Array.from({ length: DDSKETCH_TIMED_PASSES }, pass);
      const s = timed.at(-1)?.s ?? pass().s;
      const addMs = median(timed.map((t) => t.ms));

      let maxRelError = 0;
      QS.forEach((q, i) => {
        const want = exact[i] ?? 0;
        maxRelError = Math.max(
          maxRelError,
          Math.abs(s.quantile(q) - want) / want,
        );
      });
      const other = adapter.create(DDSKETCH_ACCURACY);
      for (const v of second) other.add(v);
      const message = s.toProto();
      rows.push({
        name: adapter.name,
        events,
        maxRelError,
        bytes: s.bytes(),
        protoBytes: s.protoBytes(),
        addOpsPerSec: events / (addMs / 1000),
        quantileOpsPerSec: rateOf(
          (i) => s.quantile(QS[i % QS.length] ?? 0),
          QUANTILE_CALLS,
        ),
        unionOpsPerSec: rateOf(() => {
          s.union(other);
        }, CODEC_CALLS),
        toProtoOpsPerSec: rateOf(() => s.toProto(), CODEC_CALLS),
        fromProtoOpsPerSec: rateOf(() => {
          adapter.fromProto(message);
        }, CODEC_CALLS),
      });
    }
  }
  return rows;
}
