/**
 * The strict memory of the automatic categories (rewrite plan, 04-now.md §4.4, "Memoria"): a text
 * a person or a source put in the same category the last three times goes there by itself. Pure.
 */

/** One confirmed label, by the key of its text (`memoryKey`). */
export interface Confirmation {
  key: string;
  categoryId: string;
  /** When the movement happened: "the last three" are the three most recent movements. */
  at: Date;
}

/** How many confirmations in a row a text needs before it is remembered. */
const MEMORY_STREAK = 3;

/**
 * The texts the memory holds: key → category, for every key whose last `MEMORY_STREAK`
 * confirmations all name the same category. A key with fewer, or with one that disagrees, is not
 * in it: the classifier may still suggest, but nothing is automatic.
 */
export function strictMemory(confirmations: readonly Confirmation[]): Map<string, string> {
  const byKey = new Map<string, Confirmation[]>();
  for (const one of confirmations) {
    if (one.key === "") continue;
    const list = byKey.get(one.key) ?? [];
    list.push(one);
    byKey.set(one.key, list);
  }
  const memory = new Map<string, string>();
  for (const [key, list] of byKey) {
    if (list.length < MEMORY_STREAK) continue;
    const latest = [...list].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, MEMORY_STREAK);
    if (latest.every((one) => one.categoryId === latest[0].categoryId)) memory.set(key, latest[0].categoryId);
  }
  return memory;
}
