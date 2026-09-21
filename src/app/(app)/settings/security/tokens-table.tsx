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
    <>
      {/* Seven columns do not fit a phone: below `md` the same tokens are a list, with the same
          "Revoke" beside each active one (plan F9 §3.3). */}
      <div className="overflow-x-auto max-md:hidden">
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

      <ul className="flex flex-col md:hidden">
        {tokens.map((token) => (
          <li key={token.id} className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-0">
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 font-medium break-words">{token.name}</span>
              <Badge tone={STATE_TONE[token.state]}>{t(`states.${token.state}`)}</Badge>
            </div>
            <span className="font-mono text-sm text-muted">{`pat_${token.prefix}…`}</span>
            <span className="text-sm">{token.scopes.map((scope) => t(`scopes.${scope}`)).join(" · ")}</span>
            <span className="text-sm text-muted">
              {t("columns.expires")} {token.expires} · {t("columns.lastUsed")} {token.lastUsed}
            </span>
            {token.state === "active" && (
              <div>
                <Button size="xs" variant="danger" disabled={pending} onClick={() => onRevoke(token)}>
                  {t("revoke")}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
