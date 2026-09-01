"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/require-user";
import { deleteAllocationField } from "@/lib/clients/teable";
import { UpstreamError } from "@/lib/contracts";
import { checkBaseUrl } from "@/lib/payroll/llm-config";
import { SETTING_KEYS, setSetting } from "@/lib/repo/settings";
import {
  get as getTrackedAccount,
  remove as removeTrackedAccount,
  setVisible as setTrackedVisible,
} from "@/lib/repo/tracked-accounts";
import { errorMessage, fail, succeed, type ActionResult } from "./types";

const hoursSchema = z.coerce.number().positive().max(24);

/** 1 day = 8 hours is a setting, not a constant (§9 item 6). */
export async function setHoursPerDay(input: unknown): Promise<ActionResult<null>> {
  await requireUser();

  const parsed = hoursSchema.safeParse(input);
  if (!parsed.success) return fail("Hours per day must be between 0 and 24.");

  await setSetting(SETTING_KEYS.hoursPerDay, parsed.data);
  revalidatePath("/");
  revalidatePath("/work");
  revalidatePath("/settings");
  return succeed(null);
}

const llmSchema = z.object({
  baseUrl: z.string(),
  model: z.string(),
  /**
   * Blank means "keep whatever is stored". That is what stops a save of the
   * model alone from wiping the key — the form never round-trips the secret, so
   * an empty field carries no information about the old one. Clearing is an
   * explicit action (`clearLlmApiKey`), never a side effect of an empty input.
   */
  apiKey: z.string().optional(),
});

/**
 * Settings → Payslip AI. The key is written straight to `app_settings` and is
 * never echoed back: no branch of this action puts it in a return value, an
 * error string or a log line.
 */
export async function setLlmSettings(input: unknown): Promise<ActionResult<null>> {
  await requireUser();

  const parsed = llmSchema.safeParse(input);
  if (!parsed.success) return fail("Fill in the base URL and the model.");

  const checked = checkBaseUrl(parsed.data.baseUrl);
  if (!checked.ok) return fail(checked.reason);

  const model = parsed.data.model.trim();
  if (model === "") return fail("Enter a model name, e.g. gpt-4.1-mini.");
  if (model.length > 200) return fail("That model name is too long.");

  const apiKey = parsed.data.apiKey?.trim() ?? "";
  if (apiKey.length > 500) return fail("That API key is too long.");

  await setSetting(SETTING_KEYS.llmBaseUrl, checked.url);
  await setSetting(SETTING_KEYS.llmModel, model);
  if (apiKey !== "") await setSetting(SETTING_KEYS.llmApiKey, apiKey);

  // Only Settings renders this config; the pass itself resolves it per job run.
  revalidatePath("/settings");
  return succeed(null);
}

/** The explicit way to remove a stored key; the environment remains a fallback. */
export async function clearLlmApiKey(): Promise<ActionResult<null>> {
  await requireUser();
  await setSetting(SETTING_KEYS.llmApiKey, null);
  revalidatePath("/settings");
  return succeed(null);
}

const visibilitySchema = z.object({
  slug: z.string().min(1),
  visible: z.boolean(),
});

/**
 * Settings → Conti. Hide or show a hand-tracked account in the LIST. This never
 * touches its value: a hidden account still counts in the net-worth total, it
 * just stops rendering its own row on Home and Finance.
 */
export async function setAccountVisible(input: unknown): Promise<ActionResult<null>> {
  await requireUser();

  const parsed = visibilitySchema.safeParse(input);
  if (!parsed.success) return fail("Pick an account to hide or show.");

  const row = await setTrackedVisible(parsed.data.slug, parsed.data.visible);
  if (row === null) return fail("That account no longer exists.");

  revalidatePath("/");
  revalidatePath("/finance");
  revalidatePath("/settings");
  return succeed(null);
}

const slugSchema = z.object({ slug: z.string().min(1) });

/**
 * Settings → Conti. Delete a hand-tracked account outright: it leaves the
 * registry AND its Teable column is removed if one still exists.
 *
 * The Teable column carries the account's whole history, so this is destructive
 * data loss on top of a destructive external write — the UI must confirm before
 * ever calling it. The column is deleted FIRST: if Teable fails the registry row
 * is left intact, so nothing is half-done and the owner can retry. A column that
 * is already gone is a no-op success (`deleteAllocationField`), so an account
 * whose column was removed by hand still deletes cleanly. Only once the column
 * is dealt with is the registry row removed, at which point the account stops
 * contributing to the total and disappears everywhere.
 */
export async function deleteAccount(input: unknown): Promise<ActionResult<null>> {
  await requireUser();

  const parsed = slugSchema.safeParse(input);
  if (!parsed.success) return fail("Pick an account to delete.");

  const account = await getTrackedAccount(parsed.data.slug);
  // Already gone: idempotent success rather than an error the owner cannot act on.
  if (account === null) return succeed(null);

  try {
    await deleteAllocationField(account.teableColumn);
  } catch (err) {
    if (err instanceof UpstreamError) {
      return fail(`Could not remove the Teable column: ${err.message}`);
    }
    return fail(errorMessage(err));
  }

  await removeTrackedAccount(account.slug);

  revalidatePath("/");
  revalidatePath("/finance");
  revalidatePath("/settings");
  return succeed(null);
}

export async function completeFirstRun(): Promise<ActionResult<null>> {
  await requireUser();
  await setSetting(SETTING_KEYS.firstRunComplete, true);
  revalidatePath("/settings");
  return succeed(null);
}
