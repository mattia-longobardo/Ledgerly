import type { AuditInput } from "@/platform/audit/record";
import type { AccountsRepository, Clock, ProviderLinksRepository } from "./ports";

/**
 * Everything the account use cases reach for. Kept as one bag so a route, a
 * job, or a test can assemble it once: unit tests pass the in-memory
 * repositories, production passes the Drizzle-backed ones.
 */
export interface UseCaseDeps {
  accounts: AccountsRepository;
  links: ProviderLinksRepository;
  clock: Clock;
  audit(e: AuditInput): Promise<void>;
}
