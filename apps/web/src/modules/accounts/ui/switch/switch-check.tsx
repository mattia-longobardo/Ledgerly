"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import type { CivilDate } from "@ledgerly/domain/shared/dates";
import { formatDate, formatMoney, type NumberFormat, type UiLocale } from "@ledgerly/domain/platform/format";
import { Badge } from "@ledgerly/ui/badge";
import { Button, ButtonLink, LinkButton } from "@ledgerly/ui/button";
import { Card } from "@ledgerly/ui/card";
import { Modal } from "@ledgerly/ui/modal";
import { ProgressBar } from "@ledgerly/ui/progress-bar";
import { applySwitchAction, checkSwitchAction } from "../../calls";

/** One movement of the report, as the server gives it. */
interface SwitchRow {
  day: CivilDate;
  text: string;
  cents: string;
}

/** The report of the dry run (ux/n4-account-switch.md §6); the page computes nothing of it. */
interface SwitchReportView {
  fingerprint: string;
  bank: string;
  cutDate: CivilDate;
  from: CivilDate;
  unsent: (SwitchRow & { state: "to_send" | "not_sent" })[];
  balance: {
    kind: string | null;
    on: CivilDate | null;
    local: string | null;
    bank: string | null;
    equal: boolean;
  };
  matched: (SwitchRow & { bankDay: CivilDate; bankText: string })[];
  toCheck: { cents: string; local: SwitchRow[]; bank: SwitchRow[] }[];
  onlyLocal: SwitchRow[];
  onlyBank: SwitchRow[];
  fresh: SwitchRow[];
  transfers: {
    pairs: {
      outDay: CivilDate;
      inDay: CivilDate;
      from: string;
      to: string;
      cents: string;
      byPerson: boolean;
    }[];
    byYear: { year: number; count: number; cents: string }[];
    totalCents: string;
    ambiguous: number;
  };
  publishes: boolean;
  /** The bank's account is already here as another account: the switch joins the two. */
  join: {
    account: string;
    total: number;
    matched: number;
    unmatched: SwitchRow[];
    manual: number;
    categories: number;
    notes: number;
  } | null;
}

type Refusal = { ok: false; error: string; retryAt: string | null };

interface SwitchCommands {
  check(): Promise<{ ok: true; report: SwitchReportView } | Refusal>;
  apply(fingerprint: string): Promise<{ ok: true } | Refusal>;
}

/** The two calls of the step for one account and one bank account. */
function useCommands(accountId: string, connectionId: string, bankAccountId: string): SwitchCommands {
  return useMemo(
    () => ({
      check: () => checkSwitchAction(accountId, { connectionId, bankAccountId }),
      apply: (fingerprint: string) =>
        applySwitchAction(accountId, { connectionId, bankAccountId, fingerprint }),
    }),
    [accountId, connectionId, bankAccountId],
  );
}

const PAGE = 20;
const KNOWN_ERRORS = [
  "source_unavailable",
  "bank_unavailable",
  "consent_expired",
  "rate_limited",
  "account_gone",
  "stale",
  "busy",
] as const;

/**
 * Step 2 of the switch (§6-§8): the dry run starts by itself, the report shows what blocks, then
 * what needs attention, then the rest; "Apply" exists only when the balances are equal and no
 * manual movement waits. Nothing here writes before the confirmation of "Apply".
 */
export function SwitchCheck({
  account,
  source,
  numberFormat,
  locale,
  accountId,
  target,
  leaveHref,
  doneHref,
}: {
  account: string;
  source: string;
  numberFormat: NumberFormat;
  locale: UiLocale;
  accountId: string;
  target: { connectionId: string; bankAccountId: string };
  leaveHref: Route;
  doneHref: Route;
}) {
  const t = useTranslations("accounts.switch");
  const router = useRouter();
  const commands = useCommands(accountId, target.connectionId, target.bankAccountId);
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "report"; report: SwitchReportView }
    | { kind: "error"; code: string; retryAt: string | null }
  >({ kind: "loading" });
  const [confirming, setConfirming] = useState(false);
  const [applying, startApplying] = useTransition();
  const [applyError, setApplyError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const money = (cents: string) => formatMoney(BigInt(cents), numberFormat, { signed: true });
  const plain = (cents: string) => formatMoney(BigInt(cents < "0" ? cents.slice(1) : cents), numberFormat);
  const day = (value: CivilDate | null) => (value === null ? "—" : formatDate(value, "long", locale));

  const load = useCallback(() => {
    commands
      .check()
      .then((result) =>
        setState(
          result.ok
            ? { kind: "report", report: result.report }
            : { kind: "error", code: result.error, retryAt: result.retryAt },
        ),
      )
      .catch(() => setState({ kind: "error", code: "failed", retryAt: null }));
  }, [commands]);

  function run() {
    setState({ kind: "loading" });
    setApplyError(null);
    load();
  }

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (state.kind !== "loading") heading.current?.focus();
  }, [state.kind]);

  function apply(report: SwitchReportView) {
    setConfirming(false);
    startApplying(async () => {
      const result = await commands
        .apply(report.fingerprint)
        .catch(() => ({ ok: false as const, error: "failed", retryAt: null }));
      if (result.ok) {
        router.push(doneHref);
        return;
      }
      setApplyError(errorText(result.error));
    });
  }

  function errorText(code: string): string {
    const known = KNOWN_ERRORS.find((one) => one === code);
    return known === undefined ? t("errors.failed", { source }) : t(`errors.${known}`, { source });
  }

  if (state.kind === "loading" || applying) {
    return (
      <Card>
        <div role="status" className="flex flex-col gap-3">
          <h1 tabIndex={-1} className="text-xl font-semibold">
            {applying ? t("applying.title") : t("check.waiting")}
          </h1>
          <ProgressBar value={0} dashed label={applying ? t("applying.title") : t("check.waiting")} />
          <p className="text-muted">{applying ? t("applying.stay") : t("check.waitingNote")}</p>
        </div>
      </Card>
    );
  }

  if (state.kind === "error") {
    return (
      <Card className="flex flex-col gap-3">
        <h1 ref={heading} tabIndex={-1} className="text-xl font-semibold">
          {t("check.title", { account })}
        </h1>
        <p role="alert" className="rounded-ctl bg-neg-bg px-3 py-2 text-sm text-neg">
          {errorText(state.code)} {t("check.nothingChanged")}
        </p>
        <div className="flex justify-end gap-2 max-[480px]:flex-col-reverse">
          <ButtonLink href={leaveHref}>{t("actions.leave", { source })}</ButtonLink>
          <Button variant="primary" onClick={run}>
            {t("actions.again")}
          </Button>
        </div>
      </Card>
    );
  }

  const report = state.report;
  if (report.unsent.length > 0) {
    return (
      <Card className="flex flex-col gap-3">
        <h1 ref={heading} tabIndex={-1} className="text-lg font-semibold">
          {t("unsent.title", { count: report.unsent.length, source })}
        </h1>
        <div role="alert" className="flex flex-col gap-2">
          <p className="text-sm">{t("unsent.explain", { source })}</p>
          <ul className="flex flex-col gap-1.5">
            {report.unsent.map((row, at) => (
              <li key={at} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  {day(row.day)} · {row.text || t("unsent.noPayee")}
                </span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums">{money(row.cents)}</span>
                  <Badge tone={row.state === "not_sent" ? "warn" : "neutral"}>
                    {row.state === "not_sent" ? t("unsent.notSent", { source }) : t("unsent.toSend")}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted">{t("unsent.then")}</p>
        </div>
        <div className="flex justify-end gap-2 max-[480px]:flex-col-reverse">
          <ButtonLink href={leaveHref}>{t("actions.cancel")}</ButtonLink>
          <Button variant="primary" onClick={run}>
            {t("actions.again")}
          </Button>
        </div>
      </Card>
    );
  }

  const join = report.join;
  const joinBlocked = join !== null && (join.unmatched.length > 0 || join.manual > 0);
  const balanceBlocked = !report.balance.equal;
  const blocked = balanceBlocked || joinBlocked;
  const difference =
    report.balance.local !== null && report.balance.bank !== null
      ? BigInt(report.balance.bank) - BigInt(report.balance.local)
      : null;
  return (
    <div className="flex flex-col gap-3 pb-2" style={{ scrollPaddingBottom: "4rem" }}>
      <div>
        <h1 ref={heading} tabIndex={-1} className="text-xl font-semibold">
          {t("check.title", { account })}
        </h1>
        <p className="text-muted">{t("check.route", { source, bank: report.bank })}</p>
        <p className="text-sm text-muted">
          {t("check.period", { from: day(report.from), to: day(report.cutDate) })} {t("check.nothingChanged")}
        </p>
      </div>

      <Card className="flex flex-col gap-2" aria-labelledby="switch-balance">
        <h2 id="switch-balance" className="font-semibold" role={balanceBlocked ? "alert" : undefined}>
          {report.balance.local === null
            ? t("balance.noLocal", { source })
            : report.balance.bank === null
              ? t("balance.noBank")
              : balanceBlocked
                ? t("balance.different")
                : t("balance.equal")}
        </h2>
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
          <dt>{t("balance.local", { source, date: day(report.balance.on) })}</dt>
          <dd className="text-right tabular-nums">
            {report.balance.local === null ? "—" : money(report.balance.local)}
          </dd>
          <dt>
            {t("balance.bank", {
              bank: report.bank,
              kind: report.balance.kind === null ? "" : t(`balance.kinds.${kindKey(report.balance.kind)}`),
              date: day(report.balance.on),
            })}
          </dt>
          <dd className="text-right tabular-nums">
            {report.balance.bank === null ? "—" : money(report.balance.bank)}
          </dd>
          {difference !== null && difference !== 0n && (
            <>
              <dt className="font-medium">{t("balance.difference")}</dt>
              <dd className="text-right font-medium tabular-nums">
                {formatMoney(difference < 0n ? -difference : difference, numberFormat)}
              </dd>
            </>
          )}
        </dl>
        {balanceBlocked && (
          <div className="flex flex-col gap-1.5 rounded-ctl bg-neg-bg px-3 py-2 text-sm text-neg">
            <p>{t("balance.blocked")}</p>
            <ol className="list-decimal pl-5">
              <li>{t("balance.steps.look")}</li>
              <li>{t("balance.steps.fix", { source })}</li>
              <li>{t("balance.steps.wait")}</li>
              <li>{t("balance.steps.again")}</li>
            </ol>
          </div>
        )}
      </Card>

      {join !== null && (
        <Card className="flex flex-col gap-2" aria-labelledby="switch-join">
          <h2 id="switch-join" className="font-semibold" role={joinBlocked ? "alert" : undefined}>
            {joinBlocked
              ? t("join.blocked", { account: join.account })
              : t("join.title", { account: join.account })}
          </h2>
          <p className="text-sm">{t("join.lead", { account: join.account, count: join.total })}</p>
          <p className="text-sm">{t("join.matched", { count: join.matched, total: join.total })}</p>
          {join.manual > 0 && (
            <p className="rounded-ctl bg-neg-bg px-3 py-2 text-sm text-neg">
              {t("join.manual", { account: join.account, count: join.manual })}
            </p>
          )}
          {join.unmatched.length > 0 && (
            <Section
              title={t("join.unmatched", { account: join.account })}
              count={join.unmatched.length}
              rows={join.unmatched}
              money={money}
              day={day}
              open
              warn
              note={t("join.unmatchedNote", { account: join.account, source })}
            />
          )}
          {!joinBlocked && (join.categories > 0 || join.notes > 0) && (
            <p className="text-sm text-muted">
              {t("join.carry", { categories: join.categories, notes: join.notes, account: join.account })}
            </p>
          )}
        </Card>
      )}

      <Card className="flex flex-col gap-1" aria-labelledby="switch-movements">
        <h2 id="switch-movements" className="font-semibold">
          {t("movements.title")}
        </h2>
        <Section
          title={t("movements.matched")}
          count={report.matched.length}
          rows={report.matched.map((row) => ({
            ...row,
            text: row.bankText && row.bankText !== row.text ? `${row.text} · ${row.bankText}` : row.text,
          }))}
          money={money}
          day={day}
          note={t("movements.matchedNote")}
        />
        <ToCheck
          title={t("movements.toCheck")}
          groups={report.toCheck}
          open
          note={t("movements.toCheckNote", { source })}
          sideLocal={t("movements.onSource", { source })}
          sideBank={t("movements.inBank")}
          plain={plain}
          day={day}
          countLabel={(count) => t("movements.amounts", { count })}
          outLabel={(amount) => t("movements.out", { amount })}
          inLabel={(amount) => t("movements.in", { amount })}
        />
        <Section
          title={t("movements.onlyLocal", { source })}
          count={report.onlyLocal.length}
          rows={report.onlyLocal}
          money={money}
          day={day}
          open={balanceBlocked}
          warn={balanceBlocked}
          note={t("movements.onlyLocalNote", { source })}
        />
        <Section
          title={t("movements.onlyBank")}
          count={report.onlyBank.length}
          rows={report.onlyBank}
          money={money}
          day={day}
          open={balanceBlocked}
          warn={balanceBlocked}
          note={t("movements.onlyBankNote", { source, date: day(report.cutDate) })}
        />
        <Section
          title={t("movements.fresh")}
          count={report.fresh.length}
          rows={report.fresh}
          money={money}
          day={day}
          note={t("movements.freshNote", { source, date: day(report.cutDate) })}
        />
      </Card>

      {report.transfers.pairs.length > 0 && (
        <Card className="flex flex-col gap-2" aria-labelledby="switch-transfers">
          <h2 id="switch-transfers" className="font-semibold">
            {t("transfers.title")}
          </h2>
          <p className="text-sm">
            {t("transfers.lead", {
              count: report.transfers.pairs.length,
              account,
              bank: report.bank,
              amount: plain(report.transfers.totalCents),
            })}
          </p>
          <table className="w-full text-sm">
            <caption className="sr-only">{t("transfers.byYear")}</caption>
            <thead>
              <tr className="text-left text-muted">
                <th scope="col">{t("transfers.year")}</th>
                <th scope="col" className="text-right">
                  {t("transfers.count")}
                </th>
                <th scope="col" className="text-right">
                  {t("transfers.less")}
                </th>
              </tr>
            </thead>
            <tbody>
              {report.transfers.byYear.map((year) => (
                <tr key={year.year}>
                  <td>{year.year}</td>
                  <td className="text-right tabular-nums">{year.count}</td>
                  <td className="text-right tabular-nums">{plain(year.cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Section
            title={t("transfers.list")}
            count={report.transfers.pairs.length}
            rows={report.transfers.pairs.map((pair) => ({
              day: pair.outDay,
              text: `${pair.from} → ${pair.to}${pair.byPerson ? ` · ${t("transfers.byPerson")}` : ""}`,
              cents: pair.cents,
            }))}
            money={plain}
            day={day}
          />
          {report.transfers.ambiguous > 0 && (
            <p className="text-sm text-muted">
              {t("transfers.ambiguous", { count: report.transfers.ambiguous })}
            </p>
          )}
        </Card>
      )}

      {!blocked && (
        <Card className="flex flex-col gap-2" aria-labelledby="switch-changes">
          <h2 id="switch-changes" className="font-semibold">
            {t("changes.title")}
          </h2>
          <ul className="list-disc pl-5 text-sm">
            <li>{t("changes.fromBank", { account, bank: report.bank })}</li>
            <li>{t("changes.history", { source })}</li>
            {join !== null && <li>{t("changes.joined", { account: join.account, count: join.total })}</li>}
            {report.fresh.length > 0 && <li>{t("changes.fresh", { count: report.fresh.length })}</li>}
            {report.transfers.pairs.length > 0 && (
              <li>{t("changes.transfers", { count: report.transfers.pairs.length * 2 })}</li>
            )}
            <li>{t("changes.sourceStops", { source })}</li>
            <li>{t("changes.manual")}</li>
            {report.publishes && <li>{t("changes.interests", { source })}</li>}
            <li>{t("changes.undo")}</li>
          </ul>
        </Card>
      )}

      {applyError !== null && (
        <p role="alert" className="rounded-ctl bg-neg-bg px-3 py-2 text-sm text-neg">
          {applyError}
        </p>
      )}

      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-bg py-2 max-[480px]:flex-col-reverse">
        <ButtonLink href={leaveHref}>
          {blocked ? t("actions.leave", { source }) : t("actions.cancel")}
        </ButtonLink>
        <Button variant={blocked ? "primary" : "secondary"} onClick={run}>
          {t("actions.again")}
        </Button>
        {!blocked && (
          <Button variant="primary" onClick={() => setConfirming(true)}>
            {t("actions.apply")}
          </Button>
        )}
      </div>
      {!blocked && <p className="text-sm text-muted">{t("check.leaveNote", { source })}</p>}

      <Modal
        open={confirming}
        onOpenChange={setConfirming}
        title={t("confirm.title", { account, bank: report.bank })}
        width={460}
        footer={
          <>
            <Button size="sm" autoFocus onClick={() => setConfirming(false)}>
              {t("confirm.back")}
            </Button>
            <Button variant="primary" size="sm" onClick={() => apply(report)}>
              {t("confirm.apply")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2 text-sm">
          <p>{t("confirm.body", { source })}</p>
          {report.publishes && <p>{t("confirm.interests", { source })}</p>}
          {report.transfers.pairs.length > 0 && (
            <p>{t("confirm.transfers", { amount: plain(report.transfers.totalCents) })}</p>
          )}
        </div>
      </Modal>
    </div>
  );
}

/** The kind of a bank's balance in words: a code never reaches the page. */
function kindKey(kind: string): "closing" | "expected" | "opening" | "other" {
  if (kind === "CLBD") return "closing";
  if (kind === "XPCD") return "expected";
  if (kind === "OPBD") return "opening";
  return "other";
}

/** A row of the summary that opens its rows: twenty at a time, all of them already in the page. */
function Section({
  title,
  count,
  rows,
  money,
  day,
  note,
  open = false,
  warn = false,
}: {
  title: string;
  count: number;
  rows: SwitchRow[];
  money: (cents: string) => string;
  day: (value: CivilDate) => string;
  note?: string;
  open?: boolean;
  warn?: boolean;
}) {
  const t = useTranslations("accounts.switch");
  const id = useId();
  const [expanded, setExpanded] = useState(open);
  const [shown, setShown] = useState(PAGE);
  if (count === 0) {
    return (
      <p className="flex justify-between py-1 text-sm text-muted">
        <span>{title}</span>
        <span className="tabular-nums">0</span>
      </p>
    );
  }
  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => setExpanded((value) => !value)}
        className="inline-flex min-h-6 items-center justify-between gap-2 py-1 text-left text-sm"
      >
        <span>{title}</span>
        <span className="flex items-center gap-2 tabular-nums">
          {warn ? <Badge tone="warn">{count}</Badge> : count}
          <span aria-hidden>{expanded ? "⌃" : "⌄"}</span>
        </span>
      </button>
      {expanded && (
        <div id={id} className="flex flex-col gap-1 pb-2">
          {note && <p className="text-sm text-muted">{note}</p>}
          <ul className="flex flex-col gap-1 text-sm">
            {rows.slice(0, shown).map((row, at) => (
              <li key={at} className="flex flex-wrap justify-between gap-x-3 break-words">
                <span className="min-w-0">
                  <time dateTime={row.day}>{day(row.day)}</time> · {row.text}
                </span>
                <span className="tabular-nums">{money(row.cents)}</span>
              </li>
            ))}
          </ul>
          {rows.length > shown && (
            <div className="flex items-center gap-2 text-sm text-muted">
              <LinkButton onClick={() => setShown((value) => value + PAGE)}>
                {t("more", { count: Math.min(PAGE, rows.length - shown) })}
              </LinkButton>
              <span>{t("shown", { shown, total: rows.length })}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** "To check": one inner card per amount, the two sides beside each other, no action (H44). */
function ToCheck({
  title,
  groups,
  open,
  note,
  sideLocal,
  sideBank,
  plain,
  day,
  countLabel,
  outLabel,
  inLabel,
}: {
  title: string;
  groups: SwitchReportView["toCheck"];
  open: boolean;
  note: string;
  sideLocal: string;
  sideBank: string;
  plain: (cents: string) => string;
  day: (value: CivilDate) => string;
  countLabel: (count: number) => string;
  outLabel: (amount: string) => string;
  inLabel: (amount: string) => string;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState(open);
  if (groups.length === 0) {
    return (
      <p className="flex justify-between py-1 text-sm text-muted">
        <span>{title}</span>
        <span className="tabular-nums">0</span>
      </p>
    );
  }
  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => setExpanded((value) => !value)}
        className="inline-flex min-h-6 items-center justify-between gap-2 py-1 text-left text-sm"
      >
        <span>{title}</span>
        <span className="flex items-center gap-2">
          <Badge tone="warn">{countLabel(groups.length)}</Badge>
          <span aria-hidden>{expanded ? "⌃" : "⌄"}</span>
        </span>
      </button>
      {expanded && (
        <div id={id} className="flex flex-col gap-2 pb-2">
          <p className="text-sm text-muted">{note}</p>
          {groups.map((group, at) => (
            <section
              key={at}
              aria-labelledby={`${id}-${at}`}
              className="flex flex-col gap-1 rounded-card border border-border p-2 text-sm"
            >
              <h3 id={`${id}-${at}`} className="font-medium">
                {group.cents.startsWith("-") ? outLabel(plain(group.cents)) : inLabel(plain(group.cents))}
              </h3>
              <div className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-2">
                {[
                  { label: sideLocal, rows: group.local },
                  { label: sideBank, rows: group.bank },
                ].map((side) => (
                  <ul key={side.label} aria-label={side.label} className="flex flex-col gap-0.5">
                    <li className="text-muted">
                      {side.label}: {side.rows.length}
                    </li>
                    {side.rows.map((row, index) => (
                      <li key={index} className="break-words">
                        {day(row.day)} · {row.text}
                      </li>
                    ))}
                  </ul>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
