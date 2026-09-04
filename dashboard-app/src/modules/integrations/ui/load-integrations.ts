import { listIntegrations, type IntegrationSummary } from "../application/list-integrations";
import { runIntegrationsForPrincipal } from "./run";

export function loadIntegrations(): Promise<IntegrationSummary[]> {
  return runIntegrationsForPrincipal((deps, principal) => listIntegrations(deps)(principal));
}

/**
 * One provider's summary, or null for a code no adapter is registered under —
 * which is what turns a bad URL into `notFound()` rather than a crash.
 */
export async function loadIntegration(provider: string): Promise<IntegrationSummary | null> {
  const all = await loadIntegrations();
  return all.find((i) => i.provider === provider) ?? null;
}
