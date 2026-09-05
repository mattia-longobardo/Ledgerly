"use server";

import { revalidatePath } from "next/cache";
import { PermissionDeniedError } from "@/platform/auth/principal";
import type {
  ConnectionStatus,
  DisconnectPolicy,
  ProviderCode,
  SyncKind,
  SyncRunStatus,
} from "@/platform/integrations/types";
import { connectIntegration } from "@/modules/integrations/application/connect-integration";
import { disconnectIntegration } from "@/modules/integrations/application/disconnect-integration";
import {
  ConnectionNotFoundError,
  ConnectionNotUsableError,
  ConnectionVersionMismatchError,
  CredentialValidationError,
  SyncDisabledError,
  UnknownProviderError,
} from "@/modules/integrations/application/errors";
import { runSync } from "@/modules/integrations/application/run-sync";
import { testIntegrationConnection } from "@/modules/integrations/application/test-integration-connection";
import { runIntegrationsForPrincipal } from "@/modules/integrations/ui/run";
import { errorMessage, fail, succeed, text, type ActionResult } from "./types";

/**
 * Connecting changes the navigation (Expenses and Interests appear once Wallet
 * is connected) and a sync changes balances, so both Finance surfaces are
 * revalidated alongside the Integrations pages.
 */
function revalidateIntegrations(provider: string): void {
  for (const path of [
    "/",
    "/settings/integrations",
    `/settings/integrations/${provider}`,
    "/finance",
    "/finance/accounts",
  ]) {
    revalidatePath(path);
  }
}

function mapError(err: unknown): string {
  if (err instanceof PermissionDeniedError) return "You do not have permission to change integrations.";
  if (err instanceof UnknownProviderError) return "That integration does not exist.";
  if (err instanceof ConnectionNotFoundError) return "This integration is not connected yet.";
  if (err instanceof ConnectionNotUsableError) return err.message;
  if (err instanceof SyncDisabledError) return err.message;
  if (err instanceof CredentialValidationError) return err.message;
  if (err instanceof ConnectionVersionMismatchError) {
    return "Somebody else changed this integration. Reload the page and try again.";
  }
  return errorMessage(err);
}

/** Form fields arrive as `credentials.<name>`; the prefix is stripped back off here. */
function credentialsFrom(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("credentials.") && typeof value === "string") {
      out[key.slice("credentials.".length)] = value.trim();
    }
  }
  return out;
}

export async function connectIntegrationAction(
  formData: FormData,
): Promise<ActionResult<{ status: ConnectionStatus; message: string }>> {
  const provider = text(formData.get("provider"));
  if (!provider) return fail("Pick an integration.");
  try {
    // A failed TEST is a successful ACTION carrying bad news: that is what lets
    // the form show the provider's own message without discarding what was
    // typed (Ruling P2-6).
    const { connection, test } = await runIntegrationsForPrincipal((deps, principal) =>
      connectIntegration(deps)(principal, {
        provider: provider as ProviderCode,
        credentials: credentialsFrom(formData),
        ...(text(formData.get("policy"))
          ? { disconnectPolicy: text(formData.get("policy")) as DisconnectPolicy }
          : {}),
      }),
    );
    revalidateIntegrations(provider);
    return succeed({ status: connection.status, message: test.message });
  } catch (err) {
    return fail(mapError(err));
  }
}

export async function testIntegrationAction(
  formData: FormData,
): Promise<ActionResult<{ ok: boolean; message: string }>> {
  const provider = text(formData.get("provider"));
  if (!provider) return fail("Pick an integration.");
  try {
    const result = await runIntegrationsForPrincipal((deps, principal) =>
      testIntegrationConnection(deps)(principal, provider as ProviderCode),
    );
    revalidateIntegrations(provider);
    return succeed(result);
  } catch (err) {
    return fail(mapError(err));
  }
}

export async function syncIntegrationAction(
  formData: FormData,
): Promise<ActionResult<{ runId: string; kind: SyncKind; status: SyncRunStatus }>> {
  const provider = text(formData.get("provider"));
  if (!provider) return fail("Pick an integration.");
  const kind = text(formData.get("kind"));
  try {
    // `kind` is omitted by the Sync button and defaulted inside `runSync`, so
    // this action and the REST route cannot disagree about what "sync" means.
    const run = await runIntegrationsForPrincipal((deps, principal) =>
      runSync(deps)(principal, {
        provider: provider as ProviderCode,
        ...(kind ? { kind: kind as SyncKind } : {}),
        trigger: "manual",
      }),
    );
    revalidateIntegrations(provider);
    if (run.status === "failed") return fail(run.error ?? "The sync failed.");
    return succeed({ runId: run.id, kind: run.kind, status: run.status });
  } catch (err) {
    return fail(mapError(err));
  }
}

export async function disconnectIntegrationAction(
  formData: FormData,
): Promise<ActionResult<{ policy: DisconnectPolicy }>> {
  const provider = text(formData.get("provider"));
  if (!provider) return fail("Pick an integration.");
  const policy = text(formData.get("policy"));
  try {
    const result = await runIntegrationsForPrincipal((deps, principal) =>
      disconnectIntegration(deps)(
        principal,
        provider as ProviderCode,
        policy ? (policy as DisconnectPolicy) : undefined,
      ),
    );
    revalidateIntegrations(provider);
    return succeed(result);
  } catch (err) {
    return fail(mapError(err));
  }
}
