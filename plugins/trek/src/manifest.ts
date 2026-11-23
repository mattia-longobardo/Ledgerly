import type { PluginManifest } from "@ledgerly/plugin-contract";
import packageJson from "../package.json" with { type: "json" };

export const MANIFEST: PluginManifest = {
  id: "trek",
  // The release sets every workspace's version together: the plugin's is the app's.
  version: packageJson.version,
  contract: "2",
  labels: {
    name: { en: "Trek", it: "Trek" },
    description: {
      en: "Leave days kept level with the planner of your own Trek",
      it: "Giorni di ferie allineati con il planner del tuo Trek",
    },
    steps: {},
    products: {},
  },
  // An external calendar of days off that also takes the days written here.
  capabilities: ["leaveCalendar", "provider.write"],
  // The keys the core has always sealed for Trek: a saved connection needs no new encryption.
  userSettings: [
    {
      name: "baseUrl",
      type: "text",
      required: true,
      writeOnly: false,
      label: { en: "Trek address", it: "Indirizzo di Trek" },
      help: {
        en: "The site's address, without /mcp — that is added for you.",
        it: "L'indirizzo del sito, senza /mcp: viene aggiunto da solo.",
      },
    },
    {
      name: "clientId",
      type: "text",
      required: true,
      writeOnly: false,
      label: { en: "Client ID", it: "ID del client" },
      help: {
        en: "From the machine client you created in Trek.",
        it: "Quello del machine client creato su Trek.",
      },
    },
    {
      name: "clientSecret",
      type: "secret",
      required: true,
      writeOnly: true,
      label: { en: "Client secret", it: "Segreto del client" },
      help: {
        en: "The trekcs_… secret, shown only once.",
        it: "Il segreto trekcs_…, mostrato una volta sola.",
      },
    },
  ],
  connectionFields: [],
  // Empty on purpose: the host is the person's own Trek, the `baseUrl` of their credentials, not one
  // address every person shares. The egress proxy opens the saved host for each call (decision D1),
  // in a later step of R5c.
  egress: [],
  // The hourly pass the core has always given Trek.
  schedule: { recommendedPerDay: 24, minIntervalMinutes: 60 },
  providesCategories: false,
};
