// src/app/(app)/settings/security/actions.ts — the Client API (docs/auth-design.md D3) and the
// connected apps. Under /api/v1 they are managed only with the scope `security`, which only the
// first-party clients can be granted — never a Client API, never a self-registered client.
"use server";

import { revalidatePath } from "next/cache";
import { ApiClientError, createApiClient, type MintedClient } from "@/platform/auth/api-clients";
import { requireSession } from "@/platform/auth/session";

export type ApiClientMinted = MintedClient;

type ApiClientActionResult =
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
