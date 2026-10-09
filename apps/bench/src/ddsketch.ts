import { DDSketch as DatadogSketch } from "@datadog/sketches-js";
import { DDSketch } from "distillate/ddsketch";
import { toProtobuf } from "distillate/ddsketch/protobuf";

import { rng } from "./countmin.js";

export interface QuantileSketch {
  /** The accuracy the sketch reports it was built for. */
  relativeAccuracy: number;
  add(value: number): void;
  quantile(q: number): number;
  /** Bytes in the library's own serialization. */
  bytes(): number;
  /** Bytes as Datadog's DDSketch protobuf message. */
  protoBytes(): number;
}

export interface DDSketchAdapter {
  name: string;
  create(relativeAccuracy: number): QuantileSketch;
}

/** The accuracy both sketches are built at: Datadog's own default. */
export const DDSKETCH_ACCURACY = 0.01;

/** Values per run, as for Top-K. */
export const DDSKETCH_EVENT_COUNTS = [1_000, 10_000, 100_000, 1_000_000];

/** Every quantile the error is measured at, the ends included. */
const QS = [0, 0.001, 0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99, 0.999, 1];

/**
 * At defaults: the log mapping and a store collapsing the lowest bins at 2048.
 * The stream never spans that many bins at 0.01, so it holds exactly what an
 * unbounded store would, which is what sketches-js's default keeps.
 */
export const distillateDDSketchAdapter: DDSketchAdapter = {
  name: "distillate/ddsketch",
  create(relativeAccuracy) {
    const s = DDSketch.create(relativeAccuracy);
    return {
      relativeAccuracy: s.relativeAccuracy,
      add: (v) => {
        s.add(v);
      },
      quantile: (q) => s.quantile(q),
      bytes: () => s.toBytes().length,
      protoBytes: () => toProtobuf(s).length,
    };
  },
};

/** At defaults: the log mapping and an unbounded dense store. */
export const datadogDDSketchAdapter: DDSketchAdapter = {
  name: "@datadog/sketches-js",
  create(relativeAccuracy) {
    const s = new DatadogSketch({ relativeAccuracy });
    return {
      relativeAccuracy: s.mapping.relativeAccuracy,
      add: (v) => {
        s.accept(v);
      },
      quantile: (q) => s.getValueAtQuantile(q),
      // Its only serialization is the protobuf message.
      bytes: () => s.toProto().length,
      protoBytes: () => s.toProto().length,
    };
  },
};

export const ddSketchAdapters: DDSketchAdapter[] = [
  distillateDDSketchAdapter,
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
    const sorted = [...stream].sort((a, b) => a - b);
    const exact = QS.map((q) => sorted[Math.floor(q * (events - 1))] ?? 0);

    for (const adapter of adapters) {
      const s = adapter.create(DDSKETCH_ACCURACY);
      const started = performance.now();
      for (const v of stream) s.add(v);
      const addMs = performance.now() - started;

      let maxRelError = 0;
      QS.forEach((q, i) => {
        const want = exact[i] ?? 0;
        maxRelError = Math.max(
          maxRelError,
          Math.abs(s.quantile(q) - want) / want,
        );
      });
      rows.push({
        name: adapter.name,
        events,
        maxRelError,
        bytes: s.bytes(),
        protoBytes: s.protoBytes(),
        addOpsPerSec: events / (addMs / 1000),
      });
    }
  }
  return rows;
}
