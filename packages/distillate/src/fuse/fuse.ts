import { type BytesLike } from "../core/bytes.js";
import {
  fmix64,
  type Hash128,
  hash128KeyInto,
  mul64,
  RHI,
  RLO,
} from "../core/hasher.js";
import {
  assertBodyLength,
  assertMinBodyLength,
  bytesEqual,
  type FilterJSON,
  FORMAT_VERSION,
  fromJSONEnvelope,
  HASH_MURMUR128,
  readHeader,
  SerializationError,
  toJSONEnvelope,
  UnknownHashVariantError,
  writeFrame,
} from "../core/serialize.js";

const ARITY = 3;
const TYPE_FUSE8 = 3;
const TYPE_FUSE16 = 4;

/** Thrown when binary fuse construction fails to converge on the key set. */
export class BinaryFuseBuildError extends Error {
  /** Discriminates this error from other `Error`s. */
  override readonly name = "BinaryFuseBuildError";
}

export interface FuseParams {
  seg: number;
  segMask: number;
  segCountLen: number;
  arrayLength: number;
}

// Reused across key hashing (build + lookup); same non-reentrant rationale as
// the shared RLO/RHI scratch in core/hasher.
const scratchHash: Hash128 = { w0: 0, w1: 0, w2: 0, w3: 0 };

// Cheaply perturb a stored 64-bit key hash with the attempt seed, avoiding a
// full re-hash of the key on every construction retry.
function mixSeed(lo: number, hi: number, seed: number): void {
  const l = (lo >>> 0) + (seed >>> 0);
  const carry = l > 0xffffffff ? 1 : 0;
  fmix64(l >>> 0, (hi + carry) >>> 0);
}

// High 32 bits of (hi:lo) * n, for n < 2^32: the 64-bit analogue of the
// Lemire multiply-shift reduction, mapping the hash into [0, n).
function mulhi64(lo: number, hi: number, n: number): number {
  mul64(hi, 0, n, 0);
  const aLo = RLO;
  const aHi = RHI;
  mul64(lo, 0, n, 0);
  const bHi = RHI;
  const carry = (aLo >>> 0) + (bHi >>> 0) > 0xffffffff ? 1 : 0;
  return (aHi + carry) >>> 0;
}

function positionsInto(
  mlo: number,
  mhi: number,
  seg: number,
  segMask: number,
  segCountLen: number,
  out: Uint32Array,
): void {
  const h0 = mulhi64(mlo, mhi, segCountLen);
  let h1 = (h0 + seg) >>> 0;
  let h2 = (h1 + seg) >>> 0;
  h1 = (h1 ^ (((mlo >>> 18) | (mhi << 14)) & segMask)) >>> 0;
  h2 = (h2 ^ (mlo & segMask)) >>> 0;
  out[0] = h0;
  out[1] = h1;
  out[2] = h2;
}

function fpMask(fp: Uint8Array | Uint16Array): number {
  return ((1 << (8 * fp.BYTES_PER_ELEMENT)) - 1) >>> 0;
}

export function computeParams(size: number): FuseParams {
  const seg = Math.min(
    1 << Math.floor(Math.log(size) / Math.log(3.33) + 2.25),
    1 << 18,
  );
  const segMask = seg - 1;
  const sizeFactor = Math.max(
    1.125,
    0.875 + (0.25 * Math.log(1e6)) / Math.log(Math.max(size, 2)),
  );
  const capacity = Math.round(size * sizeFactor);
  let segCount = Math.floor((capacity + seg - 1) / seg) - (ARITY - 1);
  if (segCount <= 0) segCount = 1;
  let arrayLength = (segCount + ARITY - 1) * seg;
  segCount = Math.floor((arrayLength + seg - 1) / seg) - (ARITY - 1);
  if (segCount <= 0) segCount = 1;
  arrayLength = (segCount + ARITY - 1) * seg;
  return { seg, segMask, segCountLen: segCount * seg, arrayLength };
}

/**
 * Bits stored per key by a binary fuse filter over `n` keys at a fingerprint
 * width, without building one. Counts `n` as distinct keys, since a built
 * filter sizes on its deduped hash count.
 *
 * @param n - Number of distinct keys.
 * @param width - Fingerprint width in bits: `8` for {@link BinaryFuse8}, `16` for {@link BinaryFuse16}.
 * @returns Bits per key (`0` for an empty filter).
 */
export function fuseBitsPerKey(n: number, width: 8 | 16): number {
  if (n === 0) return 0;
  return (computeParams(n).arrayLength * width) / n;
}

/**
 * Peel the 3-hypergraph and assign fingerprints so every key's XOR of its 3
 * lanes equals its fingerprint. Retries with a bumped seed on a stall; returns
 * the seed that succeeded.
 */
export function buildFingerprints(
  fp: Uint8Array | Uint16Array,
  hashes: Uint32Array,
  params: FuseParams,
  maxAttempts = 100,
): number {
  const size = hashes.length / 2;
  const { seg, segMask, segCountLen, arrayLength } = params;
  const mask = fpMask(fp);
  const counts = new Uint32Array(arrayLength);
  const xorLo = new Uint32Array(arrayLength);
  const xorHi = new Uint32Array(arrayLength);
  const orderLo = new Uint32Array(size);
  const orderHi = new Uint32Array(size);
  const orderIdx = new Uint32Array(size);
  const pos = new Uint32Array(3);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const seed = attempt;
    counts.fill(0);
    xorLo.fill(0);
    xorHi.fill(0);

    for (let i = 0; i < size; i++) {
      mixSeed(hashes[2 * i] ?? 0, hashes[2 * i + 1] ?? 0, seed);
      const mlo = RLO;
      const mhi = RHI;
      positionsInto(mlo, mhi, seg, segMask, segCountLen, pos);
      for (let j = 0; j < 3; j++) {
        const p = pos[j] ?? 0;
        counts[p] = (counts[p] ?? 0) + 1;
        xorLo[p] = (xorLo[p] ?? 0) ^ mlo;
        xorHi[p] = (xorHi[p] ?? 0) ^ mhi;
      }
    }

    const queue: number[] = [];
    for (let idx = 0; idx < arrayLength; idx++) {
      if ((counts[idx] ?? 0) === 1) queue.push(idx);
    }

    let processed = 0;
    while (queue.length > 0) {
      const idx = queue.pop();
      if (idx === undefined) break;
      if ((counts[idx] ?? 0) !== 1) continue;
      const mlo = xorLo[idx] ?? 0;
      const mhi = xorHi[idx] ?? 0;
      orderLo[processed] = mlo;
      orderHi[processed] = mhi;
      orderIdx[processed] = idx;
      processed++;
      positionsInto(mlo, mhi, seg, segMask, segCountLen, pos);
      for (let j = 0; j < 3; j++) {
        const p = pos[j] ?? 0;
        counts[p] = (counts[p] ?? 0) - 1;
        xorLo[p] = (xorLo[p] ?? 0) ^ mlo;
        xorHi[p] = (xorHi[p] ?? 0) ^ mhi;
        if ((counts[p] ?? 0) === 1) queue.push(p);
      }
    }

    if (processed === size) {
      fp.fill(0);
      for (let i = processed - 1; i >= 0; i--) {
        const mlo = orderLo[i] ?? 0;
        const mhi = orderHi[i] ?? 0;
        const idx = orderIdx[i] ?? 0;
        positionsInto(mlo, mhi, seg, segMask, segCountLen, pos);
        const p0 = pos[0] ?? 0;
        const p1 = pos[1] ?? 0;
        const p2 = pos[2] ?? 0;
        fp[idx] =
          (((mlo ^ mhi) & mask) ^
            (fp[p0] ?? 0) ^
            (fp[p1] ?? 0) ^
            (fp[p2] ?? 0)) &
          mask;
      }
      return seed;
    }
  }

  throw new BinaryFuseBuildError("binary fuse construction failed");
}

interface FuseState {
  fp: Uint8Array | Uint16Array;
  seed: number;
  params: FuseParams;
  size: number;
}

function buildState(
  keys: Iterable<BytesLike>,
  alloc: (n: number) => Uint8Array | Uint16Array,
): FuseState {
  const hashList: number[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    hash128KeyInto(key, 0, scratchHash);
    const lo = scratchHash.w0 >>> 0;
    const hi = scratchHash.w1 >>> 0;
    const id = `${String(lo)},${String(hi)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    hashList.push(lo, hi);
  }
  const size = hashList.length / 2;
  const params = computeParams(size);
  if (size === 0) return { fp: alloc(0), seed: 0, params, size: 0 };
  const hashes = Uint32Array.from(hashList);
  const fp = alloc(params.arrayLength);
  const seed = buildFingerprints(fp, hashes, params);
  return { fp, seed, params, size };
}

function fuseStateFromBytes(
  bytes: Uint8Array,
  expectedType: number,
): FuseState {
  const { type, flags, body } = readHeader(bytes);
  if (type !== expectedType) {
    throw new SerializationError(
      `expected DSTL type ${String(expectedType)}, got ${String(type)}`,
    );
  }
  if ((flags & 0x0f) !== HASH_MURMUR128) {
    throw new UnknownHashVariantError(
      `unsupported hash variant ${String(flags & 0x0f)}`,
    );
  }
  assertMinBodyLength(body.length, 16, "fuse");
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const seed = dv.getUint32(0, true);
  const seg = dv.getUint32(4, true);
  const segCountLen = dv.getUint32(8, true);
  const size = dv.getUint32(12, true);
  // segMask = seg - 1 is only a valid bitmask when seg is a power of two, and
  // the peel geometry requires segCountLen to be a whole number of segments.
  if (seg === 0 || (seg & (seg - 1)) !== 0 || seg > 1 << 18) {
    throw new SerializationError(`invalid fuse segment length ${String(seg)}`);
  }
  if (segCountLen % seg !== 0) {
    throw new SerializationError(
      `fuse segment count length ${String(segCountLen)} is not a multiple of segment length ${String(seg)}`,
    );
  }
  const bpe = expectedType === TYPE_FUSE8 ? 1 : 2;
  // An empty filter carries params but zero fingerprints; otherwise the array
  // length is fixed by the segment geometry (arrayLength = segCountLen + 2*seg).
  const expectedArrayLength = size === 0 ? 0 : segCountLen + 2 * seg;
  assertBodyLength(body.length, 16 + expectedArrayLength * bpe, "fuse");
  const laneBytes = body.subarray(16);
  const arrayLength = laneBytes.length / bpe;
  const fp =
    bpe === 1 ? new Uint8Array(arrayLength) : new Uint16Array(arrayLength);
  new Uint8Array(fp.buffer).set(laneBytes);
  return {
    fp,
    seed,
    params: { seg, segMask: seg - 1, segCountLen, arrayLength },
    size,
  };
}

/**
 * Shared behavior for the static binary fuse filters: an immutable,
 * space-efficient membership filter built once from a fixed key set.
 */
abstract class BinaryFuse {
  readonly #fp: Uint8Array | Uint16Array;
  readonly #seed: number;
  readonly #seg: number;
  readonly #segMask: number;
  readonly #segCountLen: number;
  readonly #size: number;
  readonly #pos = new Uint32Array(3);

  protected constructor(state: FuseState) {
    this.#fp = state.fp;
    this.#seed = state.seed;
    this.#seg = state.params.seg;
    this.#segMask = state.params.segMask;
    this.#segCountLen = state.params.segCountLen;
    this.#size = state.size;
  }

  /** Number of distinct keys the filter was built from. */
  get size(): number {
    return this.#size;
  }

  /** Hash seed selected during construction (may differ from 0 after a peel retry). */
  get seed(): number {
    return this.#seed;
  }

  /** Actual bits stored per key (`0` for an empty filter). */
  get bitsPerKey(): number {
    return this.#size === 0 ? 0 : (this.#fp.byteLength * 8) / this.#size;
  }

  /**
   * Serializes the filter to a portable little-endian byte layout.
   *
   * @returns The serialized filter, readable by the matching `fromBytes`.
   */
  toBytes(): Uint8Array {
    const laneBytes = new Uint8Array(
      this.#fp.buffer,
      this.#fp.byteOffset,
      this.#fp.byteLength,
    );
    const type = this.#fp.BYTES_PER_ELEMENT === 1 ? TYPE_FUSE8 : TYPE_FUSE16;
    return writeFrame(
      { version: FORMAT_VERSION, type, flags: HASH_MURMUR128 },
      16 + laneBytes.length,
      (body, dv) => {
        dv.setUint32(0, this.#seed, true);
        dv.setUint32(4, this.#seg, true);
        dv.setUint32(8, this.#segCountLen, true);
        dv.setUint32(12, this.#size, true);
        body.set(laneBytes, 16);
      },
    );
  }

  /**
   * Tests whether a key is in the set.
   *
   * @param key - The key to test.
   * @returns `true` if present (possibly a false positive); `false` guarantees absence.
   */
  has(key: BytesLike): boolean {
    if (this.#fp.length === 0) return false;
    hash128KeyInto(key, 0, scratchHash);
    mixSeed(scratchHash.w0 >>> 0, scratchHash.w1 >>> 0, this.#seed);
    const mlo = RLO;
    const mhi = RHI;
    positionsInto(
      mlo,
      mhi,
      this.#seg,
      this.#segMask,
      this.#segCountLen,
      this.#pos,
    );
    const mask = fpMask(this.#fp);
    const p0 = this.#pos[0] ?? 0;
    const p1 = this.#pos[1] ?? 0;
    const p2 = this.#pos[2] ?? 0;
    return (
      ((mlo ^ mhi) & mask) ===
      (((this.#fp[p0] ?? 0) ^ (this.#fp[p1] ?? 0) ^ (this.#fp[p2] ?? 0)) & mask)
    );
  }

  /**
   * Tests structural equality: `true` when `other` serializes to identical
   * bytes. A {@link BinaryFuse8} and a {@link BinaryFuse16} are never equal,
   * since their frames carry different type bytes.
   *
   * @param other - The filter to compare against.
   * @returns `true` if the two filters are byte-for-byte identical.
   */
  equals(other: BinaryFuse8 | BinaryFuse16): boolean {
    return bytesEqual(this.toBytes(), other.toBytes());
  }

  /**
   * Serializes the filter to a JSON-friendly envelope wrapping the base64 of
   * the `toBytes` frame.
   *
   * @returns The envelope, readable by the matching `fromJSON`.
   */
  toJSON(): FilterJSON {
    return toJSONEnvelope(this.toBytes());
  }
}

/**
 * A static 8-bit binary fuse filter: built once from a key set, then immutable.
 * The most space-efficient option (~9 bits/key at ~0.39% false-positive rate).
 *
 * @example
 * ```ts
 * const filter = BinaryFuse8.from(["alice", "bob", "carol"]);
 * filter.has("alice"); // true
 * filter.size; // 3
 * ```
 */
export class BinaryFuse8 extends BinaryFuse {
  /**
   * Builds a filter from the given keys; duplicates are ignored.
   *
   * @param keys - The complete set of keys to store.
   * @returns A new immutable filter.
   * @throws {@link BinaryFuseBuildError} if construction fails to converge.
   */
  static from(keys: Iterable<BytesLike>): BinaryFuse8 {
    return new BinaryFuse8(buildState(keys, (n) => new Uint8Array(n)));
  }

  /**
   * Restores a filter from its {@link BinaryFuse8.toBytes} serialization.
   *
   * @param bytes - The serialized filter.
   * @returns The reconstructed filter.
   */
  static fromBytes(bytes: Uint8Array): BinaryFuse8 {
    return new BinaryFuse8(fuseStateFromBytes(bytes, TYPE_FUSE8));
  }

  /**
   * Restores a filter from its {@link BinaryFuse8.toJSON} envelope.
   *
   * @param value - The JSON envelope.
   * @returns The reconstructed filter.
   */
  static fromJSON(value: unknown): BinaryFuse8 {
    return BinaryFuse8.fromBytes(fromJSONEnvelope(value));
  }
}

/**
 * A static 16-bit binary fuse filter: like {@link BinaryFuse8} but twice the
 * space (~18 bits/key) for a far lower false-positive rate (~1/65536).
 *
 * @example
 * ```ts
 * const filter = BinaryFuse16.from(["alice", "bob", "carol"]);
 * filter.has("alice"); // true
 * ```
 */
export class BinaryFuse16 extends BinaryFuse {
  /**
   * Builds a filter from the given keys; duplicates are ignored.
   *
   * @param keys - The complete set of keys to store.
   * @returns A new immutable filter.
   * @throws {@link BinaryFuseBuildError} if construction fails to converge.
   */
  static from(keys: Iterable<BytesLike>): BinaryFuse16 {
    return new BinaryFuse16(buildState(keys, (n) => new Uint16Array(n)));
  }

  /**
   * Restores a filter from its {@link BinaryFuse16.toBytes} serialization.
   *
   * @param bytes - The serialized filter.
   * @returns The reconstructed filter.
   */
  static fromBytes(bytes: Uint8Array): BinaryFuse16 {
    return new BinaryFuse16(fuseStateFromBytes(bytes, TYPE_FUSE16));
  }

  /**
   * Restores a filter from its {@link BinaryFuse16.toJSON} envelope.
   *
   * @param value - The JSON envelope.
   * @returns The reconstructed filter.
   */
  static fromJSON(value: unknown): BinaryFuse16 {
    return BinaryFuse16.fromBytes(fromJSONEnvelope(value));
  }
}
