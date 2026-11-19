"use client";

import { DataTable } from "@ledgerly/ui/data-table";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import type { Scope } from "@ledgerly/domain/platform/auth/client";
import { Button } from "@ledgerly/ui/button";
import { Modal } from "@ledgerly/ui/modal";
import { notify } from "@ledgerly/ui/toast";
import { deleteApiClientAction } from "./calls";

/** One Client API as the table shows it: the date already formatted for the reader. */
export interface ApiClientRow {
  clientId: string;
  name: string;
  scopes: Scope[];
  created: string;
}

/** Settings › Security › Client API (docs/auth-design.md D3). */
export function ApiClientsTable({ clients }: { clients: ApiClientRow[] }) {
  const t = useTranslations("settings.apiClients");
  const scopesT = useTranslations("settings.tokens");
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<ApiClientRow | null>(null);

  function onDelete(client: ApiClientRow) {
    startTransition(async () => {
      const result = await deleteApiClientAction(client.clientId);
      setConfirming(null);
      notify(
        result.ok ? t("deleted", { name: client.name }) : t("errors.failed"),
        result.ok ? "success" : "error",
      );
    });
  }

  if (clients.length === 0) {
    return <p className="px-4 py-3 text-muted">{t("empty")}</p>;
  }

  const scopes = (client: ApiClientRow) =>
    client.scopes.map((scope) => scopesT(`scopes.${scope}`)).join(" · ");

  return (
    <>
      <DataTable
        rows={clients}
        rowKey={(client) => client.clientId}
        columns={[
          {
            key: "name",
            header: t("columns.name"),
            cell: (client) => client.name,
            className: "font-medium",
            card: "title",
          },
          {
            key: "id",
            header: t("columns.clientId"),
            cell: (client) => client.clientId,
            muted: true,
            className: "font-mono text-sm",
          },
          { key: "scopes", header: t("columns.scopes"), cell: scopes, className: "text-sm" },
          {
            key: "created",
            header: t("columns.created"),
            cell: (client) => client.created,
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
            cell: (client) => (
              <Button size="xs" variant="danger" disabled={pending} onClick={() => setConfirming(client)}>
                {t("delete")}
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
            {scopesT("cancel")}
          </Button>
          <Button variant="danger" disabled={pending} onClick={() => confirming && onDelete(confirming)}>
            {t("delete")}
          </Button>
        </div>
      </Modal>
    </>
  );
}
