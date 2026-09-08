"use client";

import { useActionState } from "react";
import { createTokenAction, type CreatedToken } from "@/app/actions/security";
import type { ActionResult } from "@/app/actions/types";

/**
 * The create-a-token form and the one-time reveal.
 *
 * Ruling P8-1: the plain token comes back in the action's **result** and is
 * rendered from there. It is never put in `searchParams` — a secret in a query
 * string ends up in the address bar, the browser history, the access log and
 * the next request's `Referer`. `useActionState` is the smallest thing that
 * can hold a server action's return value across the re-render, so the token
 * never has to travel through a URL to get back onto the page.
 *
 * Bare UI (reduced Phase 7–9 conventions): a native `<form>`, native inputs,
 * no design components.
 */
export function TokensForm({ scopes }: { scopes: readonly string[] }) {
  const [state, action, pending] = useActionState<ActionResult<CreatedToken> | null, FormData>(
    createTokenAction,
    null,
  );

  return (
    <>
      <form action={action}>
        <p>
          <label htmlFor="token-name">Name</label>{" "}
          <input id="token-name" name="name" type="text" required maxLength={80} />
        </p>

        <fieldset>
          <legend>Scopes</legend>
          {/* Only what the signed-in principal actually holds: a token can
              never grant more than its owner has. */}
          {scopes.map((scope) => (
            <p key={scope}>
              <label>
                <input type="checkbox" name="scopes" value={scope} /> {scope}
              </label>
            </p>
          ))}
        </fieldset>

        <p>
          <label htmlFor="token-expiry">Expires (optional)</label>{" "}
          <input id="token-expiry" name="expiresAt" type="date" />
        </p>

        <button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create token"}
        </button>
      </form>

      {state !== null && !state.ok && <p role="alert">{state.error}</p>}

      {state !== null && state.ok && (
        <div role="status">
          <p>
            Copy this now — it is shown once and cannot be retrieved again.
          </p>
          <p>
            <code>{state.data.token}</code>
          </p>
        </div>
      )}
    </>
  );
}
