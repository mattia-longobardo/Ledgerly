import { createHash, timingSafeEqual } from "node:crypto";

export function secretMatches(provided: string | null, expected: string): boolean {
  if (provided === null) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(provided), digest(expected));
}
