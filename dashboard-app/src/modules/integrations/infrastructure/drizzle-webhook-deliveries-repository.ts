import type { DbClient } from "@/lib/db/client";
import { webhookDeliveries } from "@/lib/db/schema";
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
}
