"use client";

import type { Route } from "next";
import { useTranslations } from "next-intl";
import { type FormEvent, useEffect, useMemo, useState, useTransition } from "react";
import { Button, ButtonLink } from "@ledgerly/ui/button";
import { Card } from "@ledgerly/ui/card";
import { cn } from "@ledgerly/ui/cn";
import { Field } from "@ledgerly/ui/field";
import { Input, Select } from "@ledgerly/ui/input";
import { Skeleton } from "@ledgerly/ui/skeleton";
import { EmptyState } from "@ledgerly/ui/states";
import { type BankChoice, listBanksAction, startBankAccessAction } from "./calls";
import type { BankStepError } from "./return-errors";

/** Why the person is back on this step, from the return route (ux/n1-plugin-bank.md §6.3). */

interface BankStepProps {
  countries: { code: string; name: string }[];
  defaultCountry: string;
  /** Set when the person came back from the bank without a connection. */
  returned: { error: BankStepError; bank: string | null } | null;
}

const SETTINGS: Route = "/settings/plugins";

/** A name for comparing: no case, no accents. */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/**
 * Step 1 of "Connect a bank" (§6.2): the country, the list of its banks, and the way out to the
 * bank's own site. The list is read once per country; the search filters it in the browser, so
 * nothing the person types leaves the page.
 */
export function BankStep({ countries, defaultCountry, returned }: BankStepProps) {
  const t = useTranslations("banks.connect");
  const common = useTranslations("common");
  const connections = useTranslations("settings.connections");
  const [country, setCountry] = useState(defaultCountry);
  const [banks, setBanks] = useState<BankChoice[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<string | null>(returned?.bank ?? null);
  const [startError, setStartError] = useState<string | null>(null);
  const [noAccounts, setNoAccounts] = useState(returned?.error === "no_accounts");
  const [opening, startOpening] = useTransition();

  useEffect(() => {
    let current = true;
    listBanksAction(country)
      .then((result) => {
        if (!current) return;
        setBanks(result.ok ? result.banks : null);
        setLoadFailed(!result.ok);
      })
      .catch(() => {
        if (!current) return;
        setBanks(null);
        setLoadFailed(true);
      });
    return () => {
      current = false;
    };
  }, [country, attempt]);

  const shown = useMemo(() => {
    const wanted = fold(query.trim());
    return (banks ?? []).filter((bank) => wanted === "" || fold(bank.name).includes(wanted));
  }, [banks, query]);
  const selected = banks?.find((bank) => bank.name === chosen && !bank.connected) ?? null;

  function reload(next: string) {
    setCountry(next);
    setBanks(null);
    setLoadFailed(false);
    setChosen(null);
    setAttempt((count) => count + 1);
  }

  /** The sentence of a return that did not end with a connection, one branch per code. */
  function returnMessage(): string | null {
    if (returned === null || returned.error === "no_accounts") return null;
    const bank = returned.bank ?? "";
    if (returned.error === "denied") return t("return.denied", { bank });
    if (returned.error === "expired") return t("return.expired");
    if (returned.error === "session") return t("return.session");
    if (returned.error === "bank_unavailable") return t("return.bankUnavailable", { bank });
    if (returned.error === "unreadable") return t("return.unreadable");
    return t("return.unreachable");
  }

  function startMessage(code: string, bank: string): string {
    if (code === "auth" || code === "missing") return t("guard.invalidKey");
    if (code === "bank_unavailable") return t("return.bankUnavailable", { bank });
    if (code === "plugin_down") return t("errors.pluginDown");
    if (code === "provider_down" || code === "rate_limited" || code === "unreachable")
      return t("return.unreachable");
    return t("errors.failed");
  }

  function start(bank: string) {
    setStartError(null);
    startOpening(async () => {
      try {
        const result = await startBankAccessAction(country, bank);
        if (result.ok) {
          window.location.assign(result.url);
          return;
        }
        setStartError(startMessage(result.error, bank));
      } catch {
        setStartError(t("errors.network"));
      }
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selected !== null) start(selected.name);
  }

  if (noAccounts && returned?.bank) {
    const bank = returned.bank;
    return (
      <div className="flex flex-col gap-3">
        {startError && (
          <p role="alert" className="rounded-ctl bg-neg-bg px-3 py-2 text-sm text-neg">
            {startError}
          </p>
        )}
        <EmptyState
          title={t("noAccounts.title", { bank })}
          description={t("noAccounts.description")}
          actions={
            <>
              <Button variant="primary" disabled={opening} onClick={() => start(bank)}>
                {opening ? t("bank.opening") : t("noAccounts.retry", { bank })}
              </Button>
              <Button disabled={opening} onClick={() => setNoAccounts(false)}>
                {t("noAccounts.other")}
              </Button>
            </>
          }
        />
      </div>
    );
  }

  const alert = startError ?? returnMessage();

  return (
    <Card>
      <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
        <h1 tabIndex={-1} className="text-xl font-semibold">
          {t("bank.heading")}
        </h1>

        {alert && (
          <p role="alert" className="rounded-ctl bg-neg-bg px-3 py-2 text-sm text-neg">
            {alert}
          </p>
        )}

        <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-[minmax(0,180px)_minmax(0,1fr)]">
          <Field label={t("bank.country")} htmlFor="bank-country">
            <Select
              id="bank-country"
              value={country}
              disabled={opening}
              onChange={(event) => reload(event.currentTarget.value)}
            >
              {countries.map((one) => (
                <option key={one.code} value={one.code}>
                  {one.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("bank.search")} htmlFor="bank-search">
            <Input
              id="bank-search"
              type="search"
              placeholder={t("bank.searchPlaceholder")}
              value={query}
              disabled={opening}
              autoComplete="off"
              onChange={(event) => setQuery(event.currentTarget.value)}
              // Enter in the search field must not send the form (§8).
              onKeyDown={(event) => {
                if (event.key === "Enter") event.preventDefault();
              }}
            />
          </Field>
        </div>

        {loadFailed ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-border p-3">
            <p role="alert" className="text-sm text-neg">
              {t("bank.loadFailed")}
            </p>
            <Button size="sm" onClick={() => reload(country)}>
              {common("retry")}
            </Button>
          </div>
        ) : banks === null ? (
          <div role="status" className="flex flex-col gap-1.5">
            <span className="sr-only">{t("bank.loading")}</span>
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-11" />
            ))}
          </div>
        ) : banks.length === 0 ? (
          <p className="rounded-card border border-border p-3 text-muted">{t("bank.noneForCountry")}</p>
        ) : shown.length === 0 ? (
          <p className="rounded-card border border-border p-3 text-muted">
            {t("bank.noMatch", { query: query.trim() })}
          </p>
        ) : (
          <div
            role="radiogroup"
            aria-label={t("bank.list")}
            className="max-h-[320px] overflow-y-auto rounded-card border border-border"
          >
            {shown.map((bank) => (
              <label
                key={bank.name}
                className={cn(
                  "flex min-h-11 items-center gap-2.5 px-3 py-1.5 break-words has-[:focus-visible]:focus-ring-inset",
                  bank.connected ? "text-muted" : "cursor-pointer hover:bg-hover",
                  bank.name === chosen && "bg-sel",
                )}
              >
                {/* A bank already connected stays in the list and cannot be chosen (n2 §7): it
                    can be reached and read, so it is `aria-disabled`, not `disabled`. */}
                <input
                  type="radio"
                  name="bank"
                  value={bank.name}
                  checked={bank.name === chosen}
                  disabled={opening}
                  aria-disabled={bank.connected || undefined}
                  onChange={() => {
                    if (!bank.connected) setChosen(bank.name);
                  }}
                  className="size-4 shrink-0 accent-accent"
                />
                <span className="min-w-0">
                  {bank.name}
                  {bank.connected && (
                    <span className="block text-sm">{connections("banks.alreadyConnected")}</span>
                  )}
                </span>
              </label>
            ))}
          </div>
        )}

        <p className="text-sm text-muted">
          {t("bank.privacy")}{" "}
          {selected?.maxAccessDays != null && t("bank.duration", { days: selected.maxAccessDays })}
        </p>

        <div className="flex justify-end gap-2 max-[480px]:flex-col-reverse">
          <ButtonLink href={SETTINGS}>{common("cancel")}</ButtonLink>
          <Button type="submit" variant="primary" disabled={selected === null || opening}>
            {opening
              ? t("bank.opening")
              : selected === null
                ? t("bank.continue")
                : t("bank.continueTo", { bank: selected.name })}
          </Button>
        </div>
      </form>
    </Card>
  );
}
