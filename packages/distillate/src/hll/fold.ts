/**
 * Rho as it would have been recorded at a coarser precision.
 *
 * Dropping `d` bits of precision hands those `d` bits back to the run of zeros
 * rho measures. They sit *ahead* of everything the source rho saw, so if any of
 * them is set the first one settles the answer by itself and the source rho is
 * irrelevant; only when all `d` are zero does the source rho carry, shifted
 * along by `d`.
 *
 * This is what makes folding registers something other than taking their
 * maximum: two registers folding onto the same destination can rank one way by
 * raw value and the other way once folded.
 *
 * @param index - The register index the value was recorded against; only its
 * low `d` bits matter.
 * @param rho - The rho recorded at the finer precision.
 * @param d - Bits of precision being dropped.
 * @returns The rho at the coarser precision.
 */
export function foldRho(index: number, rho: number, d: number): number {
  const mid = index & ((1 << d) - 1);
  if (mid === 0) return d + rho;
  // Position of the first set bit within the d-bit window, counted from 1.
  return Math.clz32(mid) - 32 + d + 1;
}
