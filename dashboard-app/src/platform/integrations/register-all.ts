import { trekProvider } from "@/modules/integrations/infrastructure/trek-provider-adapter";
import { walletProvider } from "@/modules/integrations/infrastructure/wallet-provider-adapter";
import { registerProvider } from "./registry";

let done = false;

/** Idempotent, like `ensureJobsRegistered` — every entry point may call it. */
export function ensureProvidersRegistered(): void {
  if (done) return;
  done = true;
  registerProvider(walletProvider);
  registerProvider(trekProvider);
}
