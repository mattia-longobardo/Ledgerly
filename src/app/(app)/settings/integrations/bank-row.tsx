"use client";

import type { Route } from "next";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button, ButtonLink } from "@/ui/button";
import { ActionMenu } from "@/ui/menu";
import { notify } from "@/ui/toast";
import type { Tone } from "@/ui/tone";
import { useRouter } from "next/navigation";
import { ConnectionRow } from "./connection-row";
import { syncBankNowAction } from "./plugin-actions";

/** A bank's connection as its row says it (ux/n1-plugin-bank.md §5.1). */
export type BankRowState = "pending" | "active" | "error" | "expired";

export interface BankRowProps {
  id: string;
  name: string;
  state: BankRowState;
  /** The code of the last failed reading, for a row in error (§7). */
  errorCode: string | null;
  /** The bank asked to wait: the automatic readings are on hold until `nextSync`. */
  waiting: boolean;
  accounts: number;
  lastSync: string | null;
  nextSync: string | null;
  validUntil: string | null;
}

const STATUS: Record<BankRowState, { tone: Tone; dot: string }> = {
  pending: { tone: "warn", dot: "bg-warn" },
  active: { tone: "pos", dot: "bg-pos" },
  error: { tone: "neg", dot: "bg-neg" },
  expired: { tone: "neg", dot: "bg-neg" },
};

const connectHref = (query: string) => `/banks/connect?${query}` as Route;

/**
 * One bank in the section "Banks": its state, the last reading, the automatic readings, and the
 * one thing to do now — sync, choose the accounts, or renew the access. `disabled` is the
 * section's: the key was refused, and no reading can start until it is replaced (§4.4).
 */
export function BankRow({
  pluginId,
  bank,
  disabled,
  onDisconnect,
}: {
  pluginId: string;
  bank: BankRowProps;
  disabled: boolean;
  onDisconnect: () => void;
}) {
  const t = useTranslations("settings.banks");
  const router = useRouter();
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /** A reading's refusal as its sentence, one branch per code so the catalogue keys stay literal. */
  function messageFor(code: string, retryAt: string | null): string {
    if (code === "busy") return t("errors.busy");
    if (code === "rate_limited") {
      return retryAt ? t("errors.rateLimitedNow", { time: retryAt }) : t("errors.providerDown");
    }
    if (code === "auth") return t("invalidKey");
    if (code === "consent_expired") return t("detail.expired");
    if (code === "provider_down") return t("errors.providerDown");
    if (code === "invalid_data") return t("errors.invalidData");
    if (code === "plugin_down") return t("errors.pluginDown");
    return t("errors.failed");
  }

  function sync() {
    setFailure(null);
    startTransition(async () => {
      try {
        const result = await syncBankNowAction(pluginId, bank.id);
        if (!result.ok) {
          setFailure(messageFor(result.error, result.retryAt));
          return;
        }
        notify(result.created > 0 ? t("toasts.syncedNew", { count: result.created }) : t("toasts.synced"));
        router.refresh();
      } catch {
        setFailure(t("errors.network"));
      }
    });
  }

  const role =
    bank.validUntil === null
      ? t("row.role", { count: bank.accounts })
      : `${t("row.role", { count: bank.accounts })} · ${t("row.validUntil", { date: bank.validUntil })}`;
  const detail =
    failure ?? (bank.state === "error" && bank.errorCode !== null ? messageFor(bank.errorCode, null) : null);

  return (
    <div aria-busy={pending} data-testid="bank-row" data-state={bank.state}>
      <ConnectionRow
        name={bank.name}
        role={role}
        state="active"
        status={{ word: t(`states.${bank.state}`), ...STATUS[bank.state] }}
        lastSync={bank.lastSync}
        lastSyncLabel={t("row.lastSync")}
        scheduleLabel={t("row.schedule")}
        schedule={
          <>
            <div className="mt-0.5 font-medium">{t("row.scheduleValue")}</div>
            {bank.nextSync !== null && bank.state === "active" && (
              <div className="text-muted">{t("row.next", { time: bank.nextSync })}</div>
            )}
          </>
        }
        actions={
          <>
            {bank.state === "pending" && (
              <ButtonLink href={connectHref(`step=accounts&c=${bank.id}`)} variant="primary" size="sm">
                {t("actions.chooseAccounts")}
              </ButtonLink>
            )}
            {bank.state === "expired" && (
              <ButtonLink href={connectHref(`renew=${bank.id}`)} variant="primary" size="sm">
                {t("actions.renew")}
              </ButtonLink>
            )}
            {(bank.state === "active" || bank.state === "error") && (
              <Button size="sm" disabled={pending || disabled} onClick={sync}>
                {pending ? t("actions.syncing") : t("actions.sync")}
              </Button>
            )}
            <ActionMenu
              label={bank.name}
              items={[
                ...(bank.state === "active" || bank.state === "error"
                  ? [
                      {
                        label: t("actions.renew"),
                        onSelect: () => router.push(connectHref(`renew=${bank.id}`)),
                      },
                    ]
                  : []),
                { label: t("actions.disconnect"), onSelect: onDisconnect, danger: true },
              ]}
            />
          </>
        }
      />
      {bank.state === "pending" && (
        <p className="border-t border-border px-4 py-2.5 text-sm text-muted">{t("detail.pending")}</p>
      )}
      {bank.state === "expired" && (
        <p className="border-t border-border px-4 py-2.5 text-sm text-neg">{t("detail.expired")}</p>
      )}
      {bank.state === "active" && bank.waiting && bank.nextSync !== null && failure === null && (
        <p className="border-t border-border px-4 py-2.5 text-sm text-muted">
          {t("detail.rateLimited", { time: bank.nextSync })}
        </p>
      )}
      {detail !== null && (
        <p role="alert" className="border-t border-border px-4 py-2.5 text-sm text-neg">
          {detail}
        </p>
      )}
    </div>
  );
}
