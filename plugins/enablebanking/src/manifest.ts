import type { PluginManifest } from "@ledgerly/plugin-contract";
import { PROVIDER_HOST } from "./provider";

/** The countries the provider covers: the EEA and the United Kingdom. Names come from the core's locale data. */
const COUNTRIES = [
  "AT",
  "BE",
  "BG",
  "CY",
  "CZ",
  "DE",
  "DK",
  "EE",
  "ES",
  "FI",
  "FR",
  "GB",
  "GR",
  "HR",
  "HU",
  "IE",
  "IS",
  "IT",
  "LI",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "NO",
  "PL",
  "PT",
  "RO",
  "SE",
  "SI",
  "SK",
] as const;

export const MANIFEST: PluginManifest = {
  id: "enablebanking",
  version: "0.1.0",
  contract: "1",
  labels: {
    name: { en: "Enable Banking", it: "Enable Banking" },
    description: {
      en: "Accounts and transactions from European banks",
      it: "Conti e movimenti dalle banche europee",
    },
    steps: {},
    products: {},
  },
  // Account information only: no `provider.write`. The history a bank gives is a window that
  // starts at the access, not a total.
  capabilities: ["windowedHistory"],
  userSettings: [
    {
      name: "applicationId",
      type: "secret",
      required: true,
      writeOnly: true,
      label: { en: "Application ID", it: "ID applicazione" },
      help: {
        en: "You find it on your application's page on Enable Banking.",
        it: "Lo trovi nella pagina della tua applicazione su Enable Banking.",
      },
    },
    {
      name: "privateKey",
      type: "multiline",
      required: true,
      writeOnly: true,
      label: { en: "Private key", it: "Chiave privata" },
      help: {
        en: "Paste the whole content of the file, from the first line to the last.",
        it: "Incolla tutto il contenuto del file, dalla prima all'ultima riga.",
      },
    },
  ],
  connectionFields: [
    {
      name: "country",
      type: "choice",
      required: true,
      writeOnly: false,
      label: { en: "Country", it: "Paese" },
      options: COUNTRIES.map((value) => ({ value, label: { en: value, it: value } })),
    },
    {
      name: "institution",
      type: "text",
      required: true,
      writeOnly: false,
      label: { en: "Bank", it: "Banca" },
    },
  ],
  egress: [PROVIDER_HOST],
  schedule: { recommendedPerDay: 3, minIntervalMinutes: 360 },
  providesCategories: false,
};
