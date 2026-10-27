"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import type { ApiScope } from "@/platform/auth/oauth";
import { Button } from "@/ui/button";
import { Modal } from "@/ui/modal";
import { Table, TBody, Td, Th, THead, Tr } from "@/ui/table";
import { notify } from "@/ui/toast";
import { revokeConnectedAppAction } from "./actions";

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
      <div className="overflow-x-auto max-md:hidden">
        <Table>
          <THead>
            <Th>{t("columns.name")}</Th>
            <Th>{t("columns.hosts")}</Th>
            <Th>{t("columns.scopes")}</Th>
            <Th>{t("columns.since")}</Th>
            <Th align="right">
              <span className="sr-only">{t("columns.actions")}</span>
            </Th>
          </THead>
          <TBody>
            {apps.map((app) => (
              <Tr key={app.clientId}>
                <Td className="font-medium">{name(app)}</Td>
                <Td muted className="font-mono text-sm">
                  {app.hosts.join(", ")}
                </Td>
                <Td className="text-sm">{access(app)}</Td>
                <Td muted className="text-sm">
                  {app.since}
                </Td>
                <Td align="right">
                  <Button size="xs" variant="danger" disabled={pending} onClick={() => setConfirming(app)}>
                    {t("revoke")}
                  </Button>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </div>

      <ul className="flex flex-col md:hidden">
        {apps.map((app) => (
          <li
            key={app.clientId}
            className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-0"
          >
            <span className="min-w-0 font-medium break-words">{name(app)}</span>
            <span className="font-mono text-sm break-all text-muted">{app.hosts.join(", ")}</span>
            <span className="text-sm">{access(app)}</span>
            <span className="text-sm text-muted">
              {t("columns.since")} {app.since}
            </span>
            <div>
              <Button size="xs" variant="danger" disabled={pending} onClick={() => setConfirming(app)}>
                {t("revoke")}
              </Button>
            </div>
          </li>
        ))}
      </ul>

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
