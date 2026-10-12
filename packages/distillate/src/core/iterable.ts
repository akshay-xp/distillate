// The builders' one-shot loops rarely get optimized, and there for...of
// allocates an iterator result per item (about 40 bytes). Arrays, the common
// input, are walked by index instead; anything else still streams.

export function forEachItem<T>(
  items: Iterable<T>,
  fn: (item: T) => void,
): void {
  if (Array.isArray(items)) {
    const list = items as readonly T[];
    // eslint-disable-next-line @typescript-eslint/prefer-for-of -- for...of is the allocation this avoids
    for (let i = 0; i < list.length; i++) fn(list[i] as T);
    return;
  }
  for (const item of items) fn(item);
}

// For a builder that must count its input before it can size: an array is
// used as it is, anything else is collected once.
export function toArray<T>(items: Iterable<T>): readonly T[] {
  return Array.isArray(items) ? (items as readonly T[]) : [...items];
}
