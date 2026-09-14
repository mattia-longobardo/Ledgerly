"use client";

import { useTranslations } from "next-intl";
import { useTransition } from "react";
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
  return (
    <div className="flex flex-col">
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
              onClick={() => startTransition(() => revokeSessionAction(session.id))}
            >
              {t("signOut")}
            </Button>
          )}
        </div>
      ))}
      {sessions.length > 1 && (
        <div className="flex justify-end pt-3">
          <Button
            size="sm"
            variant="danger"
            disabled={pending}
            onClick={() => startTransition(() => revokeOtherSessionsAction())}
          >
            {t("signOutOthers")}
          </Button>
        </div>
      )}
    </div>
  );
}
