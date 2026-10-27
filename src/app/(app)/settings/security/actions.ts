// src/app/(app)/settings/security/actions.ts — the Client API (docs/auth-design.md D3) and the
// connected apps. Both are managed only with a session: nothing under /api/v1 can mint or revoke one.
"use server";

import { revalidatePath } from "next/cache";
import {
  ApiClientError,
  createApiClient,
  deleteApiClient,
  type MintedClient,
} from "@/platform/auth/api-clients";
import { GrantError, revokeConnectedApp } from "@/platform/auth/oauth-grants";
import { requireSession } from "@/platform/auth/session";

export type ApiClientMinted = MintedClient;

export type ApiClientActionResult =
  { ok: true; client: ApiClientMinted } | { ok: false; error: "invalid" | "failed" };

/** Creates a Client API and hands its secret back **once**: only its hash is kept. */
export async function createApiClientAction(input: {
  name: string;
  scopes: string[];
}): Promise<ApiClientActionResult> {
  await requireSession();
  try {
    const client = await createApiClient(input);
    revalidatePath("/settings/security");
    return { ok: true, client };
  } catch (error) {
    if (error instanceof ApiClientError) return { ok: false, error: "invalid" };
    console.error("[security] could not create a Client API", error instanceof Error ? error.name : "error");
    return { ok: false, error: "failed" };
  }
}

/** Deletes one of the person's own clients; its tokens stop working at once. */
export async function deleteApiClientAction(
  clientId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireSession();
  try {
    await deleteApiClient(ctx, clientId);
    revalidatePath("/settings/security");
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiClientError) return { ok: false, error: error.code };
    throw error;
  }
}

/** Takes back a consent: the app's refresh tokens go, and the next authorize asks again. */
export async function revokeConnectedAppAction(
  clientId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireSession();
  try {
    await revokeConnectedApp(ctx, clientId);
    revalidatePath("/settings/security");
    return { ok: true };
  } catch (error) {
    if (error instanceof GrantError) return { ok: false, error: error.code };
    throw error;
  }
}
