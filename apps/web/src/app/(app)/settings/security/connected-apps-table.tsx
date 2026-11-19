"use client";

import { DataTable } from "@ledgerly/ui/data-table";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import type { ApiScope } from "@ledgerly/domain/platform/auth/client";
import { Button } from "@ledgerly/ui/button";
import { Modal } from "@ledgerly/ui/modal";
import { notify } from "@ledgerly/ui/toast";
import { revokeConnectedAppAction } from "./calls";

/** One consent as the table shows it: the date already formatted for the reader. */
export interface ConnectedAppRow {
  clientId: string;
  name: string;
  hosts: string[];
  verified: boolean;
  scopes: ApiScope[];
  offline: boolean;
  since: string;
}

/** Settings › Security › Connected apps (PERS-49 SEC-05): the consents, and the way back. */
export function ConnectedAppsTable({ apps }: { apps: ConnectedAppRow[] }) {
  const t = useTranslations("settings.connectedApps");
  const scopesT = useTranslations("settings.tokens");
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<ConnectedAppRow | null>(null);

  function onRevoke(app: ConnectedAppRow) {
    startTransition(async () => {
      const result = await revokeConnectedAppAction(app.clientId);
      setConfirming(null);
      notify(result.ok ? t("revoked", { name: app.name }) : t("failed"), result.ok ? "success" : "error");
    });
  }

  if (apps.length === 0) {
    return <p className="px-4 py-3 text-muted">{t("empty")}</p>;
  }

  const access = (app: ConnectedAppRow) =>
    [...app.scopes.map((scope) => scopesT(`scopes.${scope}`)), ...(app.offline ? [t("offline")] : [])].join(
      " · ",
    );

  const name = (app: ConnectedAppRow) => (
    <>
      {app.name}
      {!app.verified && <span className="ml-2 text-sm font-normal text-warn">({t("unverified")})</span>}
    </>
  );

  return (
    <>
      <DataTable
        rows={apps}
        rowKey={(app) => app.clientId}
        columns={[
          { key: "name", header: t("columns.name"), cell: name, className: "font-medium", card: "title" },
          {
            key: "hosts",
            header: t("columns.hosts"),
            cell: (app) => app.hosts.join(", "),
            muted: true,
            className: "font-mono text-sm",
          },
          { key: "scopes", header: t("columns.scopes"), cell: access, className: "text-sm" },
          {
            key: "since",
            header: t("columns.since"),
            cell: (app) => app.since,
            muted: true,
            className: "text-sm",
            card: "labelled",
          },
          {
            key: "actions",
            header: t("columns.actions"),
            hiddenHeader: true,
            align: "right",
            card: "action",
            cell: (app) => (
              <Button size="xs" variant="danger" disabled={pending} onClick={() => setConfirming(app)}>
                {t("revoke")}
              </Button>
            ),
          },
        ]}
      />

      <Modal
        open={confirming !== null}
        onOpenChange={(next) => !next && setConfirming(null)}
        title={t("confirmTitle", { name: confirming?.name ?? "" })}
        description={t("confirmDescription")}
      >
        <div className="flex justify-end gap-2">
          <Button onClick={() => setConfirming(null)} disabled={pending}>
            {t("cancel")}
          </Button>
          <Button variant="danger" disabled={pending} onClick={() => confirming && onRevoke(confirming)}>
            {t("revoke")}
          </Button>
        </div>
      </Modal>
    </>
  );
}
