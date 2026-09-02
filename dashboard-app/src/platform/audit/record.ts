import type { DbClient } from "@/lib/db/client";
import { auditEvents } from "@/lib/db/schema";

export interface AuditInput {
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  requestId?: string | null;
  ip?: string | null;
}

export async function recordAudit(db: DbClient, e: AuditInput): Promise<void> {
  await db.insert(auditEvents).values({
    actorUserId: e.actorUserId,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId ?? null,
    before: e.before ?? null,
    after: e.after ?? null,
    requestId: e.requestId ?? null,
    ip: e.ip ?? null,
  });
}
