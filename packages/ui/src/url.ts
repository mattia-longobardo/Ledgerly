/** Search parameters as a link writes them: an absent or empty value is no parameter at all. */
export type Params = Record<string, string | undefined>;

/**
 * The page's own address with some parameters changed; an empty value drops the parameter.
 * Lives in `packages/ui` because its URL-driven controls (the period controls, the date range
 * picker) build addresses too, and `packages/ui` depends on no module.
 */
export function withParams(path: string, current: Params, changes: Params): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...current, ...changes })) {
    if (value !== undefined && value !== "") query.set(key, value);
  }
  const search = query.toString();
  return search ? `${path}?${search}` : path;
}
