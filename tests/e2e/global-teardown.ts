// tests/e2e/global-teardown.ts — the test users leave the site with everything they own.
import { runSeed } from "./homelab";

export default function globalTeardown(): void {
  runSeed("remove");
}
