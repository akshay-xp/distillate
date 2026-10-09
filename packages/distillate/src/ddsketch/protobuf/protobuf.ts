import { SerializationError } from "../../core/serialize.js";
import { DDSketch, sketchBins } from "../ddsketch.js";
import { type MappingKind, mappingWithGamma } from "../mapping.js";
import { denseStore, type Store, type StoreFactory } from "../store.js";

/** Options for {@link fromProtobuf}. */
export interface ProtobufOptions {
  /**
   * The store the decoded sketch keeps its bins in. Defaults to
   * {@link denseStore}, as sketches-go's FromProto does, so no bin is folded
   * on the way in.
   */
  store?: StoreFactory;
}

// Datadog's IndexMapping.Interpolation values, by position.
const KINDS: readonly MappingKind[] = ["log", "linear", "quadratic", "cubic"];

const VARINT = 0;
const FIXED64 = 1;
const LENGTH = 2;
const FIXED32 = 5;

// A cursor over one protobuf message. Every read checks the bytes are there,
// so a truncated or hostile message fails with a SerializationError rather
// than reading past the end.
class Reader {
  readonly #bytes: Uint8Array;
  readonly #view: DataView;
  #at: number;
  readonly #end: number;

  constructor(bytes: Uint8Array, at = 0, end = bytes.length) {
    this.#bytes = bytes;
    this.#view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.#at = at;
    this.#end = end;
  }

  get done(): boolean {
    return this.#at >= this.#end;
  }

  // Up to ten bytes, as protobuf allows. Values past 2^53 lose precision,
  // which only ever matters for a field this codec then rejects.
  varint(): number {
    let value = 0;
    for (let shift = 0; shift < 70; shift += 7) {
      if (this.#at >= this.#end)
        throw new SerializationError("protobuf: truncated varint");
      const byte = this.#bytes[this.#at++] ?? 0;
      value += (byte & 0x7f) * 2 ** shift;
      if (byte < 0x80) return value;
    }
    throw new SerializationError("protobuf: varint longer than ten bytes");
  }

  // sint32: zigzag over the low 32 bits.
  sint32(): number {
    const u = this.varint() % 2 ** 32;
    return (u >>> 1) ^ -(u & 1);
  }

  double(): number {
    this.#need(8);
    const value = this.#view.getFloat64(this.#at, true);
    this.#at += 8;
    return value;
  }

  // A length-delimited field's bytes, as a reader of their own.
  message(): Reader {
    const length = this.varint();
    this.#need(length);
    const sub = new Reader(this.#bytes, this.#at, this.#at + length);
    this.#at += length;
    return sub;
  }

  // The next field's number and wire type.
  tag(): [field: number, wire: number] {
    const tag = this.varint();
    return [Math.floor(tag / 8), tag % 8];
  }

  skip(wire: number): void {
    if (wire === VARINT) this.varint();
    else if (wire === FIXED64) this.#skipBytes(8);
    else if (wire === LENGTH) this.message();
    else if (wire === FIXED32) this.#skipBytes(4);
    else
      throw new SerializationError(
        `protobuf: unsupported wire type ${String(wire)}`,
      );
  }

  #skipBytes(n: number): void {
    this.#need(n);
    this.#at += n;
  }

  #need(n: number): void {
    if (this.#at + n > this.#end) {
      throw new SerializationError(
        "protobuf: field runs past the end of its message",
      );
    }
  }
}

function expectWire(field: string, wire: number, want: number): void {
  if (wire !== want) {
    throw new SerializationError(
      `protobuf: ${field} has wire type ${String(wire)}, want ${String(want)}`,
    );
  }
}

interface Mapping {
  gamma: number;
  indexOffset: number;
  interpolation: number;
}

function readMapping(r: Reader, into: Mapping): void {
  while (!r.done) {
    const [field, wire] = r.tag();
    if (field === 1) {
      expectWire("gamma", wire, FIXED64);
      into.gamma = r.double();
    } else if (field === 2) {
      expectWire("indexOffset", wire, FIXED64);
      into.indexOffset = r.double();
    } else if (field === 3) {
      expectWire("interpolation", wire, VARINT);
      into.interpolation = r.varint();
    } else {
      r.skip(wire);
    }
  }
}

// A Store message adds to the bins already read, since protobuf merges a
// repeated submessage field into one.
function readStore(r: Reader, bins: Map<number, number>): void {
  const contiguous: number[] = [];
  let offset = 0;
  while (!r.done) {
    const [field, wire] = r.tag();
    if (field === 1) {
      expectWire("binCounts", wire, LENGTH);
      const entry = r.message();
      let index = 0;
      let count = 0;
      while (!entry.done) {
        const [f, w] = entry.tag();
        if (f === 1) {
          expectWire("binCounts key", w, VARINT);
          index = entry.sint32();
        } else if (f === 2) {
          expectWire("binCounts value", w, FIXED64);
          count = entry.double();
        } else {
          entry.skip(w);
        }
      }
      bins.set(index, (bins.get(index) ?? 0) + count);
    } else if (field === 2) {
      // Packed, as sketches-go writes it, or one value per field, which a
      // proto3 reader must also accept.
      if (wire === LENGTH) {
        const packed = r.message();
        while (!packed.done) contiguous.push(packed.double());
      } else {
        expectWire("contiguousBinCounts", wire, FIXED64);
        contiguous.push(r.double());
      }
    } else if (field === 3) {
      expectWire("contiguousBinIndexOffset", wire, VARINT);
      offset = r.sint32();
    } else {
      r.skip(wire);
    }
  }
  contiguous.forEach((count, i) => {
    if (count !== 0) bins.set(offset + i, (bins.get(offset + i) ?? 0) + count);
  });
}

/**
 * Decodes Datadog's `DDSketch` protobuf message, as sketches-go, sketches-java
 * and the Datadog agent write it.
 *
 * The message carries no sum, min or max, so the decoded sketch derives them
 * from its bins: each is within `relativeAccuracy` of the truth for min and
 * max, and approximate for sum.
 *
 * @param bytes - The serialized message.
 * @param options - Optional store for the decoded bins.
 * @returns The decoded sketch.
 * @throws {@link SerializationError} when the message is malformed.
 */
export function fromProtobuf(
  bytes: Uint8Array,
  options: ProtobufOptions = {},
): DDSketch {
  const { store = denseStore() } = options;
  const r = new Reader(bytes);
  const mapped: Mapping = { gamma: 0, indexOffset: 0, interpolation: 0 };
  const positive = new Map<number, number>();
  const negative = new Map<number, number>();
  let zeroCount = 0;
  while (!r.done) {
    const [field, wire] = r.tag();
    if (field === 1) {
      expectWire("mapping", wire, LENGTH);
      readMapping(r.message(), mapped);
    } else if (field === 2) {
      expectWire("positiveValues", wire, LENGTH);
      readStore(r.message(), positive);
    } else if (field === 3) {
      expectWire("negativeValues", wire, LENGTH);
      readStore(r.message(), negative);
    } else if (field === 4) {
      expectWire("zeroCount", wire, FIXED64);
      zeroCount = r.double();
    } else {
      r.skip(wire);
    }
  }

  const kind = KINDS[mapped.interpolation];
  if (kind === undefined) {
    throw new SerializationError(
      `protobuf: unknown interpolation ${String(mapped.interpolation)}`,
    );
  }
  const { gamma, indexOffset } = mapped;
  if (!(gamma > 1 && gamma < Infinity) || !Number.isFinite(indexOffset)) {
    throw new SerializationError(
      "protobuf: gamma must be finite and above 1, and indexOffset finite",
    );
  }
  if (!(zeroCount >= 0 && zeroCount < Infinity)) {
    throw new SerializationError(
      `protobuf: zeroCount must be finite and not negative, got ${String(zeroCount)}`,
    );
  }
  const mapping = mappingWithGamma(kind, gamma, indexOffset);
  const lo = mapping.index(mapping.minIndexableValue);
  const hi = mapping.index(mapping.maxIndexableValue);
  for (const bins of [positive, negative]) {
    for (const [index, count] of bins) {
      // A zero count adds nothing, as in sketches-go's merge; anything else
      // must be a count a store could hold, at an index the mapping has.
      if (count === 0) {
        bins.delete(index);
      } else if (!(count > 0 && count < Infinity) || index < lo || index > hi) {
        throw new SerializationError(
          `protobuf: bin ${String(index)} with count ${String(count)} is not one a sketch could hold`,
        );
      }
    }
  }
  // Each bin is added at its own value, which the mapping indexes back to
  // the same bin, so the bins land exactly and sum, min and max follow.
  const sketch = new DDSketch(mapping.relativeAccuracy, {
    mapping: () => mapping,
    store,
  });
  for (const [index, count] of positive)
    sketch.add(mapping.value(index), count);
  for (const [index, count] of negative)
    sketch.add(-mapping.value(index), count);
  if (zeroCount > 0) sketch.add(0, zeroCount);
  return sketch;
}

// Appends protobuf's wire encodings to a growing byte list.
class Writer {
  readonly bytes: number[] = [];
  readonly #word = new DataView(new ArrayBuffer(8));

  tag(field: number, wire: number): void {
    this.varint(field * 8 + wire);
  }

  varint(value: number): void {
    while (value >= 0x80) {
      this.bytes.push((value % 0x80) | 0x80);
      value = Math.floor(value / 0x80);
    }
    this.bytes.push(value);
  }

  sint32(value: number): void {
    this.varint(((value << 1) ^ (value >> 31)) >>> 0);
  }

  double(value: number): void {
    this.#word.setFloat64(0, value, true);
    for (let i = 0; i < 8; i++) this.bytes.push(this.#word.getUint8(i));
  }

  // A length-delimited field whose contents `write` produces.
  message(field: number, write: (w: Writer) => void): void {
    const inner = new Writer();
    write(inner);
    this.tag(field, LENGTH);
    this.varint(inner.bytes.length);
    for (const byte of inner.bytes) this.bytes.push(byte);
  }
}

// proto3 leaves a field at its default out of the message; -0 is not the
// default, as sketches-go's marshaller also judges it.
function present(value: number): boolean {
  return value !== 0 || Object.is(value, -0);
}

// As sketches-go writes each store: a sparse one as the binCounts map, in
// ascending index order; any other as one contiguous run from the lowest bin
// to the highest, empty bins written as 0.
function writeStore(w: Writer, store: Store, sparse: boolean): void {
  const indices: number[] = [];
  const counts: number[] = [];
  store.forEach((index, count) => {
    indices.push(index);
    counts.push(count);
  });
  if (sparse) {
    indices.forEach((index, i) => {
      w.message(1, (entry) => {
        entry.tag(1, VARINT);
        entry.sint32(index);
        entry.tag(2, FIXED64);
        entry.double(counts[i] ?? 0);
      });
    });
    return;
  }
  const first = indices[0];
  if (first === undefined) return;
  const run = new Array<number>((indices.at(-1) ?? first) - first + 1).fill(0);
  indices.forEach((index, i) => (run[index - first] = counts[i] ?? 0));
  w.message(2, (packed) => {
    for (const count of run) packed.double(count);
  });
  if (first !== 0) {
    w.tag(3, VARINT);
    w.sint32(first);
  }
}

/**
 * Encodes a sketch as Datadog's `DDSketch` protobuf message, the form the
 * Datadog API and sketches-go read. For a dense or collapsing store the bytes
 * are exactly those sketches-go writes for the same bins.
 *
 * The message has no fields for sum, min or max, so those do not survive the
 * trip; {@link fromProtobuf} derives them from the bins.
 *
 * @param sketch - The sketch to encode.
 * @returns The serialized message.
 */
export function toProtobuf(sketch: DDSketch): Uint8Array {
  const { mapping } = sketch;
  const { positive, negative, zeroCount } = sketchBins(sketch);
  const sparse = sketch.store.kind === "sparse";
  const w = new Writer();
  w.message(1, (m) => {
    if (present(mapping.gamma)) {
      m.tag(1, FIXED64);
      m.double(mapping.gamma);
    }
    if (present(mapping.indexOffset)) {
      m.tag(2, FIXED64);
      m.double(mapping.indexOffset);
    }
    const interpolation = KINDS.indexOf(mapping.kind);
    if (interpolation !== 0) {
      m.tag(3, VARINT);
      m.varint(interpolation);
    }
  });
  w.message(2, (s) => {
    writeStore(s, positive, sparse);
  });
  w.message(3, (s) => {
    writeStore(s, negative, sparse);
  });
  if (present(zeroCount)) {
    w.tag(4, FIXED64);
    w.double(zeroCount);
  }
  return Uint8Array.from(w.bytes);
}
