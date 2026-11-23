/**
 * The manifest of contract v1 (docs/design/rewrite-plan/04-now.md §4.1): what a plugin says about
 * itself. The core reads it from `GET /manifest` and never asks "which provider is this?" again —
 * names, credential fields, the minimum interval and the capabilities all come from here (AN2,
 * rule M14). After R0 this folder becomes `packages/plugin-contract`: it imports `zod` and
 * nothing else.
 */
import { z } from "zod";

/** The contract versions this core accepts: the current one and, when there is one, the one before. */
const CONTRACT_VERSIONS = ["1"] as const;

export const PLUGIN_ID = /^[a-z][a-z0-9-]{1,30}$/;

/** A text in the two languages of the app. */
const localizedSchema = z.object({ en: z.string().min(1).max(600), it: z.string().min(1).max(600) });

const FIELD_NAME = /^[a-z][a-zA-Z0-9]{0,39}$/;

/**
 * One field a person fills in: a credential (`userSettings`) or a choice made when a connection
 * starts (`connectionFields`). `writeOnly` fields are never sent back to a browser once saved.
 */
const fieldSchema = z.object({
  name: z.string().regex(FIELD_NAME),
  type: z.enum(["text", "secret", "multiline", "choice"]),
  required: z.boolean(),
  writeOnly: z.boolean(),
  label: localizedSchema,
  help: localizedSchema.optional(),
  /** The values of a `choice`, in the order to show them. */
  options: z.array(z.object({ value: z.string().min(1).max(60), label: localizedSchema })).optional(),
});

/**
 * The capabilities the core knows today. The vocabulary is open: a value that is not in this list
 * is kept in the manifest and ignored by the core, never refused (§4.1).
 */
type Capability =
  | "provider.write"
  | "categories"
  | "editRecord"
  // The provider creates on its side a movement written in the core: its accounts are "read and
  // write" (rewrite plan, 12-account-modes.md §12.1).
  | "createRecord"
  | "deleteCategory"
  | "ledgerPosting"
  | "dailyRates"
  | "windowedHistory"
  | "totalOnlyHistory"
  | "costMethod"
  | "documents.read"
  // The plugin answers `POST /prices`: the daily closes of the markets it knows (R5d).
  | "prices.daily";

export const manifestSchema = z.object({
  id: z.string().regex(PLUGIN_ID),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  contract: z.string().regex(/^\d+$/),
  labels: z.object({
    /** The provider's name, as the person finds it on the provider's own site. */
    name: localizedSchema,
    description: localizedSchema,
    /** The texts of the steps that connect it, by step id. */
    steps: z.record(z.string().regex(FIELD_NAME), localizedSchema).default({}),
    /** What the person confirms before the data is read, when the provider asks for that. */
    attestation: localizedSchema.optional(),
    /** The names of the provider's products, by product id. */
    products: z.record(z.string().regex(FIELD_NAME), localizedSchema).default({}),
  }),
  capabilities: z.array(z.string().min(1).max(60)).max(40),
  /** The credentials of one person. */
  userSettings: z.array(fieldSchema).max(20),
  /** What a person chooses for one connection. */
  connectionFields: z.array(fieldSchema).max(20),
  /** The hosts the plugin calls on the internet. Declared now; enforced from R5c (decision I8). */
  egress: z.array(z.string().min(1).max(200)).max(20),
  schedule: z.object({
    /** How many automatic syncs a day the plugin recommends. */
    recommendedPerDay: z.number().int().min(1).max(24),
    /** Minutes between two automatic syncs, at least. */
    minIntervalMinutes: z.number().int().min(1).max(1440),
  }),
  /** Whether the provider gives categories with the movements. */
  providesCategories: z.boolean(),
});
export type PluginManifest = z.infer<typeof manifestSchema>;

/** Whether the manifest declares `capability`. An unknown capability is never an error. */
export function hasCapability(
  manifest: Pick<PluginManifest, "capabilities">,
  capability: Capability,
): boolean {
  return manifest.capabilities.includes(capability);
}

export function acceptsContract(version: string): boolean {
  return (CONTRACT_VERSIONS as readonly string[]).includes(version);
}
