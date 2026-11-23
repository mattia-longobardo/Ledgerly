import type { PluginManifest } from "@ledgerly/plugin-contract";
import packageJson from "../package.json" with { type: "json" };
import { WALLET_HOST } from "./http";

export const MANIFEST: PluginManifest = {
  id: "wallet",
  // The release sets every workspace's version together: the plugin's is the app's.
  version: packageJson.version,
  contract: "2",
  labels: {
    name: { en: "Wallet", it: "Wallet" },
    description: {
      en: "Accounts, movements and categories from Wallet by BudgetBakers",
      it: "Conti, movimenti e categorie da Wallet di BudgetBakers",
    },
    steps: {},
    products: {},
  },
  // A source read with a token, that also takes the movements, edits and categories written here.
  capabilities: ["source.read", "createRecord", "editRecord", "categories", "deleteCategory"],
  userSettings: [
    {
      name: "token",
      type: "secret",
      required: true,
      writeOnly: true,
      label: { en: "API token", it: "Token API" },
      help: {
        en: "Paste the API token from your Wallet account.",
        it: "Incolla il token API del tuo account Wallet.",
      },
    },
  ],
  connectionFields: [],
  egress: [WALLET_HOST],
  // The hourly sync the core has always given Wallet.
  schedule: { recommendedPerDay: 24, minIntervalMinutes: 60 },
  providesCategories: true,
};
