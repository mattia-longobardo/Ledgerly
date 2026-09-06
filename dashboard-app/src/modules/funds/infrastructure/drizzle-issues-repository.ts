import { and, asc, eq, inArray, like, ne, sql } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { reconciliationIssues, type ReconciliationIssueRow } from "@/lib/db/schema";
import type { IssuesRepository, ReconciliationIssue } from "../application/ports";

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
