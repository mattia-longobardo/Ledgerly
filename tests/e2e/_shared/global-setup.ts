// tests/e2e/_shared/global-setup.ts — the test users and their sample data, fresh for every run,
// and, with E2E_ORIGIN, the proxy to the site's origin for the whole run (origin.ts).
import { BASE_URL, ORIGIN, ORIGIN_PROXY_PORT } from "./env";
import { runSeed } from "./homelab";
import { startOriginProxy } from "./origin";

export default async function globalSetup(): Promise<(() => Promise<void>) | undefined> {
  try {
    runSeed("seed");
    if (!ORIGIN) return undefined;
    return await startOriginProxy(ORIGIN, new URL(BASE_URL).host, ORIGIN_PROXY_PORT);
  } catch (error) {
    // A failed setup gets no teardown from Playwright: the test users leave here.
    runSeed("remove");
    throw error;
  }
}
