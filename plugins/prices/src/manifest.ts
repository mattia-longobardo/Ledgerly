import type { PluginManifest } from "@ledgerly/plugin-contract";
import { SOURCE_HOSTS } from "./yahoo";

/**
 * The prices plugin (rewrite plan R5d): the daily closes of shares and ETFs from Yahoo Finance, for
 * the whole instance. No credential and no connection: the core calls it from its daily job.
 */
export const MANIFEST: PluginManifest = {
  id: "prices",
  version: "0.1.0",
  contract: "1",
  labels: {
    name: { en: "Yahoo Finance", it: "Yahoo Finance" },
    description: {
      en: "Daily closing prices of shares and ETFs",
      it: "Prezzi di chiusura giornalieri di azioni ed ETF",
    },
    steps: {},
    products: {},
  },
  capabilities: ["prices.daily"],
  userSettings: [],
  connectionFields: [],
  egress: [...SOURCE_HOSTS],
  schedule: { recommendedPerDay: 1, minIntervalMinutes: 720 },
  providesCategories: false,
};
