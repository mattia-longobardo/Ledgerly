"use client";

import { useTranslations } from "next-intl";
import { useTransition } from "react";
import type { Scope } from "@/platform/tokens/rules";
import type { TokenState } from "@/platform/tokens/rules";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Table, TBody, Td, Th, THead, Tr } from "@/ui/table";
import { notify } from "@/ui/toast";
import { revokeTokenAction } from "./actions";

/** One token as the table shows it: dates already formatted for the reader. */
export interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  scopes: Scope[];
  expires: string;
  lastUsed: string;
  state: TokenState;
}

const STATE_TONE = { active: "pos", expired: "neutral", revoked: "neg" } as const;

/** Settings › Security › Access tokens (spec §5.3, design row 853). */
export function TokensTable({ tokens }: { tokens: TokenRow[] }) {
  const t = useTranslations("settings.tokens");
  const [pending, startTransition] = useTransition();

  function onRevoke(token: TokenRow) {
    startTransition(async () => {
      const result = await revokeTokenAction(token.id);
      notify(
        result.ok ? t("revoked", { name: token.name }) : t("errors.failed"),
        result.ok ? "success" : "error",
      );
    });
  }

  if (tokens.length === 0) {
    return <p className="px-4 py-3 text-muted">{t("empty")}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <THead>
          <Th>{t("columns.name")}</Th>
          <Th>{t("columns.token")}</Th>
          <Th>{t("columns.scopes")}</Th>
          <Th>{t("columns.expires")}</Th>
          <Th>{t("columns.lastUsed")}</Th>
          <Th>{t("columns.status")}</Th>
          <Th align="right">
            <span className="sr-only">{t("columns.actions")}</span>
          </Th>
        </THead>
        <TBody>
          {tokens.map((token) => (
            <Tr key={token.id}>
              <Td className="font-medium">{token.name}</Td>
              <Td muted className="font-mono text-sm">
                {`pat_${token.prefix}…`}
              </Td>
              <Td className="text-sm">{token.scopes.map((scope) => t(`scopes.${scope}`)).join(" · ")}</Td>
              <Td muted className="text-sm">
                {token.expires}
              </Td>
              <Td muted className="text-sm">
                {token.lastUsed}
              </Td>
              <Td>
                <Badge tone={STATE_TONE[token.state]}>{t(`states.${token.state}`)}</Badge>
              </Td>
              <Td align="right">
                {token.state === "active" && (
                  <Button size="xs" variant="danger" disabled={pending} onClick={() => onRevoke(token)}>
                    {t("revoke")}
                  </Button>
                )}
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
