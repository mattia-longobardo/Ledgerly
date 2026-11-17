// tests/e2e/_shared/global-teardown.ts — the test users leave the site with everything they own.
import { runSeed } from "./homelab";

export default function globalTeardown(): void {
  runSeed("remove");
}
