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
  /** "Active now" for this device, the sign-in date for the others. */
  status: string;
  current: boolean;
}

/** Full-bleed rows in an unpadded card, as in the design: device, status, then Sign out. */
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
    <div className="flex flex-col text-sm">
      {error && (
        <p role="alert" className="border-b border-border px-4 py-2.5 text-neg">
          {error}
        </p>
      )}
      {sessions.map((session) => (
        <div
          key={session.id}
          className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-6 border-b border-border px-4 py-2.5 last:border-0"
        >
          <div className="min-w-0">
            <div className="truncate text-base font-medium">{session.device}</div>
            <div className="truncate text-muted">{session.detail}</div>
          </div>
          <span className="text-muted">{session.status}</span>
          {session.current ? (
            <span />
          ) : (
            <Button
              size="xs"
              variant="danger"
              className="font-normal"
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
        <div className="flex justify-end px-4 py-2.5">
          <Button size="sm" variant="danger" disabled={pending} onClick={revokeOthers}>
            {t("signOutOthers")}
          </Button>
        </div>
      )}
    </div>
  );
}
