"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ErrorInline } from "@/components/ui/ErrorInline";
import { disconnectIntegrationAction } from "@/app/actions/integrations";
import {
  DISCONNECT_POLICIES,
  describeDisconnectPolicy,
} from "@/modules/integrations/domain/connection";
import type { DisconnectPolicy } from "@/platform/integrations/types";
import { DANGER, FIELD, LABEL, SECONDARY } from "./styles";

/**
 * The helper text is `describeDisconnectPolicy(policy)` verbatim — the same
 * sentence the API documents — so the UI can never describe a policy
 * differently from the thing that carries it out.
 *
 * The confirm step is not decoration: `purge` deletes accounts that nothing
 * else references.
 */
export function DisconnectForm({ provider, current }: { provider: string; current: DisconnectPolicy }) {
  const router = useRouter();
  const [policy, setPolicy] = useState<DisconnectPolicy>(current);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const data = new FormData();
      data.append("provider", provider);
      data.append("policy", policy);
      const result = await disconnectIntegrationAction(data);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setConfirming(false);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {error !== null && <ErrorInline message={error} />}
      <label className="flex flex-col gap-1.5">
        <span className={LABEL}>What happens to the data</span>
        <select
          value={policy}
          onChange={(event) => {
            setPolicy(event.target.value as DisconnectPolicy);
            setConfirming(false);
          }}
          className={FIELD}
        >
          {DISCONNECT_POLICIES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <span className="text-body-sm text-fg-muted">{describeDisconnectPolicy(policy)}</span>
      </label>
      {confirming ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={pending} onClick={submit} className={DANGER}>
            Yes, disconnect
          </button>
          <button type="button" onClick={() => setConfirming(false)} className={SECONDARY}>
            Cancel
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className={DANGER}>
          Disconnect
        </button>
      )}
    </div>
  );
}
