import { SerializationError } from "../../core/serialize.js";
import { DDSketch } from "../ddsketch.js";
import { type MappingKind, mappingWithGamma } from "../mapping.js";
import { denseStore, type StoreFactory } from "../store.js";

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

  const kind = KINDS[mapped.interpolation] ?? "log";
  const mapping = mappingWithGamma(kind, mapped.gamma, mapped.indexOffset);
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
