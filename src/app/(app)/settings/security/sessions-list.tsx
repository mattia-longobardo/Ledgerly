"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { revokeOtherSessionsAction, revokeSessionAction } from "@/modules/users/actions";
import { Button } from "@/ui/button";

/** What the browser gets per session: an id, never the bearer token. */
export interface SessionRow {
  id: string;
  device: string;
  detail: string;
  current: boolean;
}

export function SessionsList({ sessions }: { sessions: SessionRow[] }) {
  const t = useTranslations("settings.sessions");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function revoke(sessionId: string) {
    startTransition(async () => {
      try {
        const result = await revokeSessionAction(sessionId);
        setError(result.ok ? null : t("errors.failed"));
      } catch {
        setError(t("errors.failed"));
      }
    });
  }

  function revokeOthers() {
    startTransition(async () => {
      try {
        const result = await revokeOtherSessionsAction();
        setError(result.ok ? null : t("errors.failed"));
      } catch {
        setError(t("errors.failed"));
      }
    });
  }

  return (
    <div className="flex flex-col">
      {error && (
        <p role="alert" className="pb-2 text-sm text-neg">
          {error}
        </p>
      )}
      {sessions.map((session) => (
        <div
          key={session.id}
          className="grid grid-cols-[1fr_auto] items-center gap-6 border-b border-border py-2 last:border-0"
        >
          <div>
            <div className="font-medium">{session.device}</div>
            <div className="text-sm text-muted">
              {session.detail}
              {session.current && ` · ${t("thisDevice")}`}
            </div>
          </div>
          {!session.current && (
            <Button
              size="xs"
              variant="danger"
              disabled={pending}
              aria-label={t("signOutDevice", { device: session.device })}
              onClick={() => revoke(session.id)}
            >
              {t("signOut")}
            </Button>
          )}
        </div>
      ))}
      {sessions.length > 1 && (
        <div className="flex justify-end pt-3">
          <Button size="sm" variant="danger" disabled={pending} onClick={revokeOthers}>
            {t("signOutOthers")}
          </Button>
        </div>
      )}
    </div>
  );
}
