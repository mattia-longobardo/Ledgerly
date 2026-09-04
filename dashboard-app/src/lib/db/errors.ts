/**
 * Postgres reports a unique-index violation as pg error code 23505, wrapped
 * by drizzle-orm 0.45 on `.cause`. Shared by every repository that maps a
 * unique-index collision to a `"duplicate_name"` return value instead of
 * letting the raw error escape — previously duplicated verbatim across the
 * accounts groups, expenses categories and expenses labels repositories.
 */
export function isUniqueViolation(err: unknown): boolean {
  return (err as { cause?: { code?: string } } | undefined)?.cause?.code === "23505";
}
