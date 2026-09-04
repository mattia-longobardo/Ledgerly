import type { IntegrationProvider, ProviderRegistry } from "./types";

const providers = new Map<string, IntegrationProvider>();

export function registerProvider(provider: IntegrationProvider): void {
  if (providers.has(provider.code)) throw new Error(`provider ${provider.code} is already registered`);
  providers.set(provider.code, provider);
}

/**
 * The read side, handed to use cases as a port so a test can pass a two-line
 * stub instead of registering the real adapters.
 */
export const providerRegistry: ProviderRegistry = {
  get: (code) => providers.get(code) ?? null,
  list: () => [...providers.values()],
};

export function resetProviderRegistry(): void {
  providers.clear();
}
