/**
 * The items under each key, in the order they come: `valueOf` (the item itself by default) is what
 * each list holds. A key with no item has no entry.
 */
export function groupBy<T, K>(items: Iterable<T>, keyOf: (item: T) => K): Map<K, T[]>;
export function groupBy<T, K, V>(
  items: Iterable<T>,
  keyOf: (item: T) => K,
  valueOf: (item: T) => V,
): Map<K, V[]>;
export function groupBy<T, K, V>(
  items: Iterable<T>,
  keyOf: (item: T) => K,
  valueOf?: (item: T) => V,
): Map<K, (T | V)[]> {
  const groups = new Map<K, (T | V)[]>();
  for (const item of items) {
    const key = keyOf(item);
    const value = valueOf ? valueOf(item) : item;
    const list = groups.get(key);
    if (list) list.push(value);
    else groups.set(key, [value]);
  }
  return groups;
}
