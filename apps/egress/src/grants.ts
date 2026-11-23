/**
 * The hosts the core opens for one plugin for a short time (rewrite plan R5c, decision D1): the
 * person's own host of a plugin whose catalog entry says its host is dynamic. In memory only: a
 * restart loses them, and the core sends the grant again before its next call.
 */

/** The longest a grant lives, whatever the core asks. */
const MAX_GRANT_SECONDS = 600;

export class Grants {
  readonly #until = new Map<string, number>();

  add(plugin: string, host: string, ttlSeconds: number, now = Date.now()): void {
    for (const [key, until] of this.#until) if (until <= now) this.#until.delete(key);
    const seconds = Math.min(Math.max(ttlSeconds, 1), MAX_GRANT_SECONDS);
    this.#until.set(`${plugin} ${host}`, now + seconds * 1000);
  }

  allows(plugin: string, host: string, now = Date.now()): boolean {
    return (this.#until.get(`${plugin} ${host}`) ?? 0) > now;
  }
}
