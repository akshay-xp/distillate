import type { Registers } from "./registers.js";

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

/**
 * Folds one register array into another of equal or coarser precision.
 *
 * Several source registers share each destination register, and the largest
 * *folded* value among them wins. That is not the largest raw value: see
 * {@link foldRho}.
 *
 * @param src - Registers to read; left untouched.
 * @param srcP - Precision `src` was built at.
 * @param dst - Registers to fold into, raised in place.
 * @param dstP - Precision of `dst`; at most `srcP`.
 */
export function foldDense(
  src: Registers,
  srcP: number,
  dst: Registers,
  dstP: number,
): void {
  const d = srcP - dstP;
  for (let i = 0; i < 2 ** srcP; i++) {
    const rho = src.get(i);
    // Zero means no key ever landed here, which is not a rho of zero.
    if (rho === 0) continue;
    dst.raise(i >>> d, foldRho(i, rho, d));
  }
}
