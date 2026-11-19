"use client";

import { ChevronDown } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState, useTransition } from "react";
import { Button, ButtonLink, LinkButton } from "@ledgerly/ui/button";
import { cn } from "@ledgerly/ui/cn";
import { ActionMenu } from "@ledgerly/ui/menu";
import { notify } from "@ledgerly/ui/toast";
import { type Tone, TONE_TEXT } from "@ledgerly/ui/tone";
import { runConnectionAction } from "./connection-actions";

/** The five values of a connection's state, and `absent` for a connection that does not exist. */
export type RowStatusValue = "ok" | "running" | "late" | "action" | "paused" | "absent";

/** What a person can do with a connection: the row knows the kind, never the provider. */
export type ActionKind =
  | "update"
  | "renew"
  | "replaceKey"
  | "chooseAccounts"
  | "resume"
  | "enable"
  | "connect"
  | "test"
  | "settings"
  | "advanced"
  | "disconnect";

/** One action: its words, and where it leads when it is a page. */
export interface RowAction {
  kind: ActionKind;
  label: string;
  href?: string;
  danger?: boolean;
}

/** One reading in the history, already in the person's words. */
export interface HistoryItem {
  /** ISO, for `<time>`. */
  at: string;
  when: string;
  outcome: "ok" | "failed" | "running" | "skipped";
  text: string;
  byYou: boolean;
}

/**
 * Everything the row is told (ux/n2-connection-status.md §3.1), built by the page on the server.
 * No error code, no credential and no value of a provider: sentences, and kinds of action.
 */
export interface ConnectionRowProps {
  id: string;
  name: string;
  detail: string | null;
  status: {
    value: RowStatusValue;
    text: string;
    /** ISO of the instant the text is about, for `<time>`; with `title`, the full date and time. */
    at: string | null;
    title: string | null;
    action: RowAction | null;
  };
  /** The warning that an access is about to end (§6.3). */
  notice: { text: string; action: RowAction | null } | null;
  /** At most ten readings; `null` for a row that shows no history (a connection that does not exist). */
  history: HistoryItem[] | null;
  /** Where every reading is, when there are more than the ten shown. */
  historyMore: string | null;
  menu: RowAction[];
}

const DOT: Record<RowStatusValue, string> = {
  ok: "bg-pos",
  running: "bg-accent",
  late: "bg-warn",
  action: "bg-neg",
  paused: "bg-faint",
  absent: "bg-faint",
};

const WORD_TONE: Record<RowStatusValue, Tone> = {
  ok: "pos",
  running: "accent",
  late: "warn",
  action: "neg",
  paused: "muted",
  absent: "muted",
};

const OUTCOME_TONE: Record<HistoryItem["outcome"], Tone> = {
  ok: "pos",
  failed: "neg",
  running: "accent",
  skipped: "muted",
};

/** While a reading runs the page asks again: every 5 seconds, for 2 minutes at most. */
const REFRESH_MS = 5_000;
const REFRESH_FOR_MS = 120_000;

/**
 * The row of one connection (§3): the same for a bank, a data source and an investment service.
 * It draws what it is given and knows three ways to act: the parent's own (`handled`: a dialog
 * the parent owns), a page (`href`), or the one Server Action of every connection.
 */
export function ConnectionRow({
  id,
  name,
  detail,
  status,
  notice,
  history,
  historyMore,
  menu,
  handled = [],
  onAction,
  disabled = false,
  compact = false,
}: ConnectionRowProps & {
  /** The kinds the parent does itself, with a dialog of its own. */
  handled?: readonly ActionKind[];
  onAction?: (kind: ActionKind) => void;
  /** The parent is busy: no action can start. */
  disabled?: boolean;
  /** The short form of an account's page (§3.3): dot, word, text, the action as a link. */
  compact?: boolean;
}) {
  const t = useTranslations("settings.connections");
  const router = useRouter();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const busy = pending || disabled;

  useEffect(() => {
    if (status.value !== "running") return;
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > REFRESH_FOR_MS) clearInterval(timer);
      else if (document.visibilityState === "visible") router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [status.value, router]);

  function run(action: RowAction) {
    setFailure(null);
    if (handled.includes(action.kind)) {
      onAction?.(action.kind);
      return;
    }
    if (action.href !== undefined) {
      router.push(action.href as Route);
      return;
    }
    startTransition(async () => {
      try {
        const result = await runConnectionAction(id, action.kind);
        if (!result.ok) {
          setFailure(result.message);
          return;
        }
        if (result.toast !== null) notify(result.toast);
        router.refresh();
      } catch {
        setFailure(t("codes.network"));
      }
    });
  }

  const isLink = (action: RowAction) => action.href !== undefined && !handled.includes(action.kind);
  const statusText =
    status.at === null ? (
      status.text
    ) : (
      <time dateTime={status.at} title={status.title ?? undefined}>
        {status.text}
      </time>
    );
  const word = (
    <span className={cn("text-sm font-medium whitespace-nowrap", TONE_TEXT[WORD_TONE[status.value]])}>
      {t(`status.${status.value}`)}
    </span>
  );
  const alert = failure !== null && (
    <p role="alert" className={cn("text-sm text-neg", !compact && "border-t border-border px-4 py-2.5")}>
      {failure}
    </p>
  );

  if (compact) {
    const action = status.action;
    return (
      <div aria-busy={pending} data-testid="connection-status" data-status={status.value} className="text-sm">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span aria-hidden className={cn("size-[7px] shrink-0 rounded-full", DOT[status.value])} />
          {word}
          <span aria-live="polite" className={status.value === "paused" ? "text-muted" : undefined}>
            {statusText}
          </span>
          {action !== null &&
            (isLink(action) ? (
              <a
                href={action.href}
                className="focus-ring inline-flex h-6 items-center rounded-xs font-medium text-accent hover:underline"
              >
                {action.label}
              </a>
            ) : (
              <LinkButton disabled={busy} onClick={() => run(action)}>
                {pending && action.kind === "update" ? t("actions.updating") : action.label}
              </LinkButton>
            ))}
        </div>
        {alert}
      </div>
    );
  }

  const primary = status.action;
  const prominent = status.value === "action" || primary?.kind === "enable" || primary?.kind === "connect";
  const items = menu.map((item) => ({
    label: item.label,
    danger: item.danger,
    onSelect: () => run(item),
  }));

  return (
    <div
      aria-busy={pending}
      data-testid="connection-row"
      data-status={status.value}
      className="@container flex flex-col"
    >
      <div className="grid grid-cols-1 gap-x-5 gap-y-2.5 px-4 py-3.5 @min-[560px]:@max-[819px]:grid-cols-2 @min-[820px]:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_176px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2">
            <span aria-hidden className={cn("size-[7px] shrink-0 rounded-full", DOT[status.value])} />
            <span className="min-w-0 font-semibold break-words">{name}</span>
            {word}
          </div>
          {detail !== null && <p className="mt-0.5 text-sm break-words text-muted">{detail}</p>}
        </div>

        <div className="min-w-0 text-sm">
          {/* Always there, also empty: it is the live region that says when the state changes. */}
          <p
            aria-live="polite"
            className={cn("break-words empty:hidden", status.value === "paused" && "text-muted")}
          >
            {statusText}
          </p>
          {history !== null && (
            <button
              type="button"
              aria-expanded={open}
              aria-controls={listId}
              onClick={() => setOpen((value) => !value)}
              className="focus-ring mt-0.5 inline-flex h-6 items-center gap-1 rounded-xs text-sm font-medium text-accent hover:underline"
            >
              {t("history.toggle")}
              <ChevronDown aria-hidden className={cn("size-3.5", open && "rotate-180")} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 @min-[560px]:@max-[819px]:col-span-2 @min-[820px]:justify-end">
          {primary !== null &&
            (isLink(primary) ? (
              <ButtonLink
                href={primary.href as Route}
                variant={prominent ? "primary" : "secondary"}
                size="sm"
                className="@max-[559px]:flex-1"
              >
                {primary.label}
              </ButtonLink>
            ) : (
              <Button
                variant={prominent ? "primary" : "secondary"}
                size="sm"
                disabled={busy}
                onClick={() => run(primary)}
                className="@max-[559px]:flex-1"
              >
                {pending && primary.kind === "update" ? t("actions.updating") : primary.label}
              </Button>
            ))}
          {items.length > 0 && <ActionMenu label={name} items={items} />}
        </div>
      </div>

      {notice !== null && (
        <p
          role="status"
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border px-4 py-2.5 text-sm text-warn"
        >
          <span>{notice.text}</span>
          {notice.action !== null && (
            <LinkButton disabled={busy} onClick={() => run(notice.action as RowAction)}>
              {notice.action.label}
            </LinkButton>
          )}
        </p>
      )}

      {alert}

      {history !== null && (
        <div id={listId} hidden={!open} className="border-t border-border px-4 py-2.5 text-sm">
          {history.length === 0 ? (
            <p className="text-muted">{t("history.empty")}</p>
          ) : (
            <ol aria-label={t("history.label", { name })} className="flex flex-col">
              {history.map((item) => (
                <li
                  key={item.at}
                  className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 py-1.5 @min-[560px]:grid-cols-[9.5rem_7rem_minmax(0,1fr)]"
                >
                  <time dateTime={item.at} className="text-muted">
                    {item.when}
                  </time>
                  <span className={cn("font-medium", TONE_TEXT[OUTCOME_TONE[item.outcome]])}>
                    {t(`history.${item.outcome}`)}
                  </span>
                  <span className="col-span-2 break-words @min-[560px]:col-span-1">
                    {item.text}
                    {item.byYou && <span className="text-muted"> · {t("history.byYou")}</span>}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {historyMore !== null && (
            <a
              href={historyMore}
              className="focus-ring mt-1 inline-flex h-6 items-center rounded-xs font-medium text-accent hover:underline"
            >
              {t("history.all")}
            </a>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * One source in the list of Settings › Integrations (plugin-settings.md §2.1): the name, the state
 * of its connection, one line of summary and an arrow. The whole row is the one link to the
 * source's page, where every setting of the source is.
 */
export function SourceLinkRow({
  slug,
  name,
  status,
  summary,
  href,
}: {
  slug: string;
  name: string;
  status: RowStatusValue;
  summary: string | null;
  href: string;
}) {
  const t = useTranslations("settings.connections");
  return (
    <Link
      href={href as Route}
      data-testid="source-row"
      data-source={slug}
      data-status={status}
      className="focus-ring flex min-h-6 items-center justify-between gap-4 px-4 py-3.5 hover:bg-hover"
    >
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-x-2">
          <span aria-hidden className={cn("size-[7px] shrink-0 rounded-full", DOT[status])} />
          <span className="min-w-0 font-semibold break-words">{name}</span>
          <span className={cn("text-sm font-medium whitespace-nowrap", TONE_TEXT[WORD_TONE[status]])}>
            {t(`status.${status}`)}
          </span>
        </span>
        {summary !== null && <span className="mt-0.5 block text-sm text-muted">{summary}</span>}
      </span>
      <span aria-hidden className="shrink-0 text-muted">
        →
      </span>
    </Link>
  );
}

/**
 * Under "Disconnect" (plugin-settings.md §4.2): a disconnection keeps the settings, and the way
 * to stop using a source for good is on the source's page.
 */
export function DeactivateLink({ href, provider }: { href: string; provider: string }) {
  const t = useTranslations("settings.plugin");
  return (
    <Link
      href={href as Route}
      className="focus-ring inline-flex min-h-6 items-center self-start rounded-xs text-accent underline underline-offset-2"
    >
      {t("disconnect.toDeactivate", { provider })}
    </Link>
  );
}
