import { and, eq } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { resolveExternal } from "../../../platform/integrations/service";
import { type IncomingTransaction } from "../rules";
import { categories } from "../schema";
import { ensureSourceCategory, knownSourceCategory } from "../source-categories";
import { type ProviderGroupRef, TaxonomyError, adoptOrCreateCategory, adoptOrCreateLabel } from "../taxonomy";

/* Provider upsert */

/**
 * Resolves the local ids of the categories and labels a batch of movements names, once per
 * distinct name, before any rule is asked anything: `rules.ts` never resolves a name (T3), and
 * `taxonomy.ts` writes through `getDb()`, so all of this has to happen before the writes begin.
 */
export class ProviderIds {
  private readonly categoryCache = new Map<string, ResolvedCategory>();
  private readonly labelCache = new Map<string, string | null>();

  constructor(
    private readonly ctx: Pick<Ctx, "userId">,
    private readonly provider: string,
  ) {}

  /**
   * Spec §9.1's order, through `taxonomy.ts`: the provider's own link, then the exact local name,
   * then a new category. With an id but no name there is nothing to adopt or create, so the link
   * is the only answer and an unlinked id leaves the movement uncategorised.
   */
  async category(incoming: IncomingTransaction): Promise<ResolvedCategory> {
    const externalId = incoming.categoryExternalId;
    const name = incoming.categoryName?.trim() ?? "";
    const groupName = incoming.categoryGroupName?.trim() ?? "";
    // The provider's group becomes the parent (F2.5), so it is part of what makes a category.
    const group =
      groupName === "" ? undefined : { name: groupName, externalId: incoming.categoryGroupExternalId };
    const key = JSON.stringify([externalId, name, group?.externalId ?? null, groupName]);
    const known = this.categoryCache.get(key);
    if (known !== undefined) return known;

    const resolved = await this.resolveCategory(externalId, name, group);
    this.categoryCache.set(key, resolved);
    return resolved;
  }

  /**
   * The category this app holds for the source's own, then where that one counts (N3.1): the
   * person may have matched it to another category, and its movements count there.
   */
  private async resolveCategory(
    externalId: string | null,
    name: string,
    group: ProviderGroupRef | undefined,
  ): Promise<ResolvedCategory> {
    if (name !== "") {
      try {
        const category = await adoptOrCreateCategory(
          this.ctx,
          name,
          externalId === null ? undefined : { provider: this.provider, externalId },
          group,
        );
        if (externalId === null) return { categoryId: category.id, sourceCategoryId: null };
        const source = await ensureSourceCategory(
          this.ctx,
          this.provider,
          { externalId, name, groupName: group?.name ?? null },
          category.id,
        );
        return { categoryId: source?.categoryId ?? category.id, sourceCategoryId: source?.id ?? null };
      } catch (error) {
        // A name the column cannot hold (over `NAME_MAX`) leaves the movement uncategorised
        // rather than failing the whole sync: the amount and the date are worth more than the
        // label, and the person can file it by hand.
        if (error instanceof TaxonomyError && error.code === "invalid") return NO_CATEGORY;
        throw error;
      }
    }
    if (externalId === null) return NO_CATEGORY;
    const linked = await resolveExternal(this.ctx, this.provider, "category", [externalId]);
    const entityId = linked.get(externalId);
    if (entityId === undefined) return NO_CATEGORY;
    const [row] = await getDb()
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.id, entityId), userScoped(this.ctx).owns(categories)));
    if (!row) return NO_CATEGORY;
    const source = await knownSourceCategory(this.ctx, this.provider, externalId);
    return { categoryId: source?.categoryId ?? row.id, sourceCategoryId: source?.id ?? null };
  }

  /** Labels are matched by name alone (§9.1). Sorted, so an unchanged set compares equal. */
  async labels(names: readonly string[]): Promise<string[]> {
    const ids: string[] = [];
    for (const raw of names) {
      const name = raw.trim();
      if (name === "") continue;
      let id = this.labelCache.get(name);
      if (id === undefined) {
        id = await this.adoptLabel(name);
        this.labelCache.set(name, id);
      }
      if (id !== null && !ids.includes(id)) ids.push(id);
    }
    return ids.sort();
  }

  private async adoptLabel(name: string): Promise<string | null> {
    try {
      const label = await adoptOrCreateLabel(this.ctx, name);
      return label.id;
    } catch (error) {
      // Same reasoning as a category name the column cannot hold: drop the label, keep the row.
      if (error instanceof TaxonomyError && error.code === "invalid") return null;
      throw error;
    }
  }
}

/** The category a movement of a source counts under, and the row of the source's own category. */
interface ResolvedCategory {
  categoryId: string | null;
  sourceCategoryId: string | null;
}

const NO_CATEGORY: ResolvedCategory = { categoryId: null, sourceCategoryId: null };

/** The last movement wins when a provider's pages repeat an external id inside one answer. */
export function deduped(incoming: readonly IncomingTransaction[]): IncomingTransaction[] {
  const byExternalId = new Map<string, IncomingTransaction>();
  for (const movement of incoming) {
    if (movement.externalId.trim() === "") continue;
    byExternalId.set(movement.externalId, movement);
  }
  return [...byExternalId.values()];
}
