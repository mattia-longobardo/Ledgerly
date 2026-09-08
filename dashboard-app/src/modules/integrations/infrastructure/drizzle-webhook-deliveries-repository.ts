import { and, asc, eq, gte } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { webhookDeliveries } from "@/lib/db/schema";
import type { ProviderCode } from "@/platform/integrations/types";
import type { WebhookDeliveriesRepository, WebhookDelivery } from "../application/ports";

export class DrizzleWebhookDeliveriesRepository implements WebhookDeliveriesRepository {
  constructor(private readonly db: DbClient) {}

  async record(input: WebhookDelivery): Promise<void> {
    await this.db.insert(webhookDeliveries).values({
      connectionId: input.connectionId,
      provider: input.provider,
      direction: "inbound",
      event: input.event,
      payloadHash: input.payloadHash,
      status: input.status,
      error: input.error,
      receivedAt: input.receivedAt,
    });
  }

  async findAccepted(
    provider: ProviderCode,
    payloadHash: string,
    since: Date,
  ): Promise<{ connectionId: string | null; receivedAt: Date } | null> {
    const [row] = await this.db
      .select({ connectionId: webhookDeliveries.connectionId, receivedAt: webhookDeliveries.receivedAt })
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.provider, provider),
          eq(webhookDeliveries.direction, "inbound"),
          eq(webhookDeliveries.payloadHash, payloadHash),
          eq(webhookDeliveries.status, "accepted"),
          gte(webhookDeliveries.receivedAt, since),
        ),
      )
      .orderBy(asc(webhookDeliveries.receivedAt))
      .limit(1);
    return row ?? null;
  }
}
