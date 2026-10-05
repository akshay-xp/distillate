/**
 * Rows measured one adapter per process, merged back into the order the
 * in-process sweep produced: each key count, then each adapter in turn.
 */
export function interleave<T>(perAdapter: T[][]): T[] {
  const out: T[] = [];
  const rounds = perAdapter[0]?.length ?? 0;
  for (let i = 0; i < rounds; i++) {
    for (const rows of perAdapter) out.push(rows[i]!);
  }
  return out;
}
