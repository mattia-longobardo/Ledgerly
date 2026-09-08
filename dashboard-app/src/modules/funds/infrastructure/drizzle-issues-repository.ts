import { and, asc, desc, eq, inArray, like, ne, sql } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { reconciliationIssues, type ReconciliationIssueRow } from "@/lib/db/schema";
import type { IssuesRepository, ListIssuesOptions, ListIssuesPage, ReconciliationIssue } from "../application/ports";

function toIssue(row: ReconciliationIssueRow): ReconciliationIssue {
  return {
    ...row,
    detail: row.detail as Record<string, unknown>,
    severity: row.severity as ReconciliationIssue["severity"],
    status: row.status as ReconciliationIssue["status"],
  };
}

type NewIssue = Pick<ReconciliationIssue, "userId" | "domain" | "entityType" | "entityId" | "kind" | "severity" | "detail">;

export class DrizzleIssuesRepository implements IssuesRepository {
  constructor(private readonly db: DbClient) {}

  async list(userId: string, opts: ListIssuesOptions): Promise<ListIssuesPage> {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const conditions = [eq(reconciliationIssues.userId, userId)];
    if (opts.domain) conditions.push(eq(reconciliationIssues.domain, opts.domain));
    if (opts.status) conditions.push(eq(reconciliationIssues.status, opts.status));
    if (opts.severity) conditions.push(eq(reconciliationIssues.severity, opts.severity));
    if (opts.cursor) {
      // Keyset, not offset: the same shape `DrizzleTransactionsRepository.list`
      // uses, so a page cannot repeat or skip a row when one is resolved
      // between requests. An unknown cursor falls through to the first page
      // rather than erroring — it can only come from a row that has since gone.
      const [anchor] = await this.db
        .select({ createdAt: reconciliationIssues.createdAt, id: reconciliationIssues.id })
        .from(reconciliationIssues)
        .where(and(eq(reconciliationIssues.userId, userId), eq(reconciliationIssues.id, opts.cursor)))
        .limit(1);
      if (anchor) {
        conditions.push(sql`(${reconciliationIssues.createdAt}, ${reconciliationIssues.id}) < (${anchor.createdAt}, ${anchor.id})`);
      }
    }
    const rows = await this.db
      .select()
      .from(reconciliationIssues)
      .where(and(...conditions))
      .orderBy(desc(reconciliationIssues.createdAt), desc(reconciliationIssues.id))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map(toIssue);
    return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
  }

  async get(userId: string, id: string): Promise<ReconciliationIssue | null> {
    const [row] = await this.db
      .select()
      .from(reconciliationIssues)
      .where(and(eq(reconciliationIssues.userId, userId), eq(reconciliationIssues.id, id)))
      .limit(1);
    return row ? toIssue(row) : null;
  }

  async listOpen(userId: string, domain: string, entityIdPrefix?: string): Promise<ReconciliationIssue[]> {
    const predicates = [eq(reconciliationIssues.userId, userId), eq(reconciliationIssues.domain, domain), ne(reconciliationIssues.status, "resolved")];
    if (entityIdPrefix) predicates.push(like(reconciliationIssues.entityId, `${entityIdPrefix}%`));
    const rows = await this.db
      .select()
      .from(reconciliationIssues)
      .where(and(...predicates))
      .orderBy(asc(reconciliationIssues.createdAt), asc(reconciliationIssues.id));
    return rows.map(toIssue);
  }

  async upsertOpen(input: NewIssue): Promise<ReconciliationIssue> {
    const [row] = await this.db
      .insert(reconciliationIssues)
      .values(input)
      .onConflictDoUpdate({
        target: [reconciliationIssues.userId, reconciliationIssues.domain, reconciliationIssues.entityType, reconciliationIssues.entityId, reconciliationIssues.kind],
        targetWhere: sql`status <> 'resolved'`,
        set: { detail: input.detail, severity: input.severity, updatedAt: new Date() },
      })
      .returning();
    return toIssue(row!);
  }

  async resolveMissing(userId: string, domain: string, entityIdPrefix: string, keep: readonly { entityType: string; entityId: string; kind: string }[], by: string | null, at: Date): Promise<number> {
    const candidates = await this.listOpen(userId, domain, entityIdPrefix);
    const keepKeys = new Set(keep.map((item) => `${item.entityType}\u0000${item.entityId}\u0000${item.kind}`));
    const ids = candidates
      .filter((row) => !keepKeys.has(`${row.entityType}\u0000${row.entityId}\u0000${row.kind}`))
      .map((row) => row.id);
    if (ids.length === 0) return 0;
    const rows = await this.db
      .update(reconciliationIssues)
      .set({ status: "resolved", resolvedBy: by, resolvedAt: at, updatedAt: at })
      .where(and(
        eq(reconciliationIssues.userId, userId),
        eq(reconciliationIssues.domain, domain),
        ne(reconciliationIssues.status, "resolved"),
        like(reconciliationIssues.entityId, `${entityIdPrefix}%`),
        inArray(reconciliationIssues.id, ids),
      ))
      .returning({ id: reconciliationIssues.id });
    return rows.length;
  }

  async setStatus(userId: string, id: string, status: "acknowledged" | "resolved", by: string, at: Date): Promise<ReconciliationIssue | null> {
    const [row] = await this.db
      .update(reconciliationIssues)
      .set({
        status,
        resolvedBy: status === "resolved" ? by : null,
        resolvedAt: status === "resolved" ? at : null,
        updatedAt: at,
      })
      .where(and(eq(reconciliationIssues.userId, userId), eq(reconciliationIssues.id, id), ne(reconciliationIssues.status, "resolved")))
      .returning();
    return row ? toIssue(row) : null;
  }
}
