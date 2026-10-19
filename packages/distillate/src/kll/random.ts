// splitmix32: a u32 state stepped by the golden-ratio constant and mixed by
// murmur3's finalizer. The state is the whole generator, so a frame carries it
// as one u32 and a decoded sketch flips the coins the original would have.

/** The state after one step. */
export function nextState(state: number): number {
  return (state + 0x9e_37_79_b9) >>> 0;
}

/** The pseudorandom u32 a state yields. */
export function mix(state: number): number {
  let z = state;
  z = Math.imul(z ^ (z >>> 16), 0x85_eb_ca_6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2_b2_ae_35);
  return (z ^ (z >>> 16)) >>> 0;
}
