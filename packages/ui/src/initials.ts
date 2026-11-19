// The badge of a person in Admin › Users (audit USR-8: presentation, not domain).

/**
 * The two letters of the round badge in Admin › Users (design row 874). A name gives its first
 * and last word's initials, an address falls back to the first two letters of its local part —
 * an invitation has no name yet, and an empty circle reads as a missing avatar rather than a
 * person who has not arrived.
 */
export function initialsOf(name: string, email: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length > 0) {
    const first = words[0][0];
    const last = words.length > 1 ? words[words.length - 1][0] : (words[0][1] ?? "");
    return (first + last).toUpperCase();
  }
  return (email.split("@")[0] || "?").slice(0, 2).toUpperCase();
}
