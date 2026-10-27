"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import type { Scope } from "@/platform/tokens/rules";
import { Button } from "@/ui/button";
import { Modal } from "@/ui/modal";
import { Table, TBody, Td, Th, THead, Tr } from "@/ui/table";
import { notify } from "@/ui/toast";
import { deleteApiClientAction } from "./actions";

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
      <div className="overflow-x-auto max-md:hidden">
        <Table>
          <THead>
            <Th>{t("columns.name")}</Th>
            <Th>{t("columns.clientId")}</Th>
            <Th>{t("columns.scopes")}</Th>
            <Th>{t("columns.created")}</Th>
            <Th align="right">
              <span className="sr-only">{t("columns.actions")}</span>
            </Th>
          </THead>
          <TBody>
            {clients.map((client) => (
              <Tr key={client.clientId}>
                <Td className="font-medium">{client.name}</Td>
                <Td muted className="font-mono text-sm">
                  {client.clientId}
                </Td>
                <Td className="text-sm">{scopes(client)}</Td>
                <Td muted className="text-sm">
                  {client.created}
                </Td>
                <Td align="right">
                  <Button size="xs" variant="danger" disabled={pending} onClick={() => setConfirming(client)}>
                    {t("delete")}
                  </Button>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </div>

      <ul className="flex flex-col md:hidden">
        {clients.map((client) => (
          <li
            key={client.clientId}
            className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-0"
          >
            <span className="min-w-0 font-medium break-words">{client.name}</span>
            <span className="font-mono text-sm break-all text-muted">{client.clientId}</span>
            <span className="text-sm">{scopes(client)}</span>
            <span className="text-sm text-muted">
              {t("columns.created")} {client.created}
            </span>
            <div>
              <Button size="xs" variant="danger" disabled={pending} onClick={() => setConfirming(client)}>
                {t("delete")}
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
