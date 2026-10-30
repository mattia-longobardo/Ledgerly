import { PROVIDER_SCHEDULE, providerOf } from "@/modules/investments/catalog";
import { DEFAULT_SYNC_SCHEDULE, type SyncSchedule } from "@/platform/integrations/schedule";

/** What a connection starts on, and so what "Use recommended" fills in: it differs by provider. */
export function recommendedSchedule(provider: string): SyncSchedule {
  return providerOf(provider)?.connect === "apikey" ? PROVIDER_SCHEDULE : DEFAULT_SYNC_SCHEDULE;
}
