// tests/e2e/global-setup.ts — the test users and their sample data, fresh for every run.
import { runSeed } from "./homelab";

export default function globalSetup(): void {
  runSeed("seed");
}
