"use client";

// The row of one connection (ux/n2-connection-status.md §3, audit UI-SET-3): the same for a bank, a
// data source and an investment service. It draws what it is given and knows three ways to act: the
// parent's own (`handled`: a dialog the parent owns), a page (`href`), or the action the container
// gives it (`run`). No error code, no credential and no value of a provider: sentences, and kinds.
import { ChevronDown } from "lucide-react";
import { type ReactNode, useEffect, useId, useState, useTransition } from "react";
import { useTranslations } from "use-intl";
import { Button, ButtonLink, LinkButton } from "./button";
import { cn } from "./cn";
import { ActionMenu } from "./menu";
import { useRouter } from "./router";
import { notify } from "./toast";
import { type Tone, TONE_TEXT } from "./tone";

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

/** Everything the row is told (§3.1): sentences, and kinds of action. */
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

/** Does one kind of action to one connection, and answers the toast to show or the sentence of a refusal. */
type RunConnectionAction = (
  connectionId: string,
  kind: ActionKind,
) => Promise<{ ok: true; toast: string | null } | { ok: false; message: string }>;

interface RowOptions {
  /** The kinds the parent does itself, with a dialog of its own. */
  handled?: readonly ActionKind[];
  onAction?: (kind: ActionKind) => void;
  /** The parent is busy: no action can start. */
  disabled?: boolean;
  /** The short form of an account's page (§3.3): dot, word, text, the action as a link. */
  compact?: boolean;
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

function useRefreshWhileRunning(value: RowStatusValue) {
  const router = useRouter();
  useEffect(() => {
    if (value !== "running") return;
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > REFRESH_FOR_MS) clearInterval(timer);
      else if (document.visibilityState === "visible") router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [value, router]);
}

/** How the row acts: the parent's dialog, a page, or the container's action; and what came of it. */
function useRowActions(id: string, run: RunConnectionAction, options: RowOptions) {
  const text = useTranslations("settings.connections");
  const router = useRouter();
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const handled = options.handled ?? [];
  const isLink = (action: RowAction) => action.href !== undefined && !handled.includes(action.kind);

  function act(action: RowAction) {
    setFailure(null);
    if (handled.includes(action.kind)) return options.onAction?.(action.kind);
    if (action.href !== undefined) return router.push(action.href);
    startTransition(async () => {
      try {
        const result = await run(id, action.kind);
        if (!result.ok) return setFailure(result.message);
        if (result.toast !== null) notify(result.toast);
        router.refresh();
      } catch {
        setFailure(text("codes.network"));
      }
    });
  }

  return { act, isLink, failure, pending, busy: pending || options.disabled === true };
}

type Actions = ReturnType<typeof useRowActions>;

export function StatusWord({ value }: { value: RowStatusValue }) {
  const text = useTranslations("settings.connections");
  return (
    <span className={cn("text-sm font-medium whitespace-nowrap", TONE_TEXT[WORD_TONE[value]])}>
      {text(`status.${value}`)}
    </span>
  );
}

function StatusText({ status }: { status: ConnectionRowProps["status"] }) {
  if (status.at === null) return status.text;
  return (
    <time dateTime={status.at} title={status.title ?? undefined}>
      {status.text}
    </time>
  );
}

export const Dot = ({ value }: { value: RowStatusValue }) => (
  <span aria-hidden className={cn("size-[7px] shrink-0 rounded-full", DOT[value])} />
);

function Failure({ failure, compact }: { failure: string | null; compact: boolean }) {
  if (failure === null) return null;
  return (
    <p role="alert" className={cn("text-sm text-neg", !compact && "border-t border-border px-4 py-2.5")}>
      {failure}
    </p>
  );
}

/** The label of an action that runs: "Updating…" while "Update now" is on its way. */
function useActionLabel(actions: Actions) {
  const text = useTranslations("settings.connections");
  return (action: RowAction) =>
    actions.pending && action.kind === "update" ? text("actions.updating") : action.label;
}

function CompactRow({ status, actions }: { status: ConnectionRowProps["status"]; actions: Actions }) {
  const label = useActionLabel(actions);
  const action = status.action;
  return (
    <div
      aria-busy={actions.pending}
      data-testid="connection-status"
      data-status={status.value}
      className="text-sm"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <Dot value={status.value} />
        <StatusWord value={status.value} />
        <span aria-live="polite" className={status.value === "paused" ? "text-muted" : undefined}>
          <StatusText status={status} />
        </span>
        {action !== null &&
          (actions.isLink(action) ? (
            <a
              href={action.href}
              className="focus-ring inline-flex h-6 items-center rounded-xs font-medium text-accent hover:underline"
            >
              {action.label}
            </a>
          ) : (
            <LinkButton disabled={actions.busy} onClick={() => actions.act(action)}>
              {label(action)}
            </LinkButton>
          ))}
      </div>
      <Failure failure={actions.failure} compact />
    </div>
  );
}

function StateCell({
  props,
  open,
  listId,
  onToggle,
}: {
  props: ConnectionRowProps;
  open: boolean;
  listId: string;
  onToggle: () => void;
}) {
  const text = useTranslations("settings.connections");
  return (
    <div className="min-w-0 text-sm">
      {/* Always there, also empty: it is the live region that says when the state changes. */}
      <p
        aria-live="polite"
        className={cn("break-words empty:hidden", props.status.value === "paused" && "text-muted")}
      >
        <StatusText status={props.status} />
      </p>
      {props.history !== null && (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={listId}
          onClick={onToggle}
          className="focus-ring mt-0.5 inline-flex h-6 items-center gap-1 rounded-xs text-sm font-medium text-accent hover:underline"
        >
          {text("history.toggle")}
          <ChevronDown aria-hidden className={cn("size-3.5", open && "rotate-180")} />
        </button>
      )}
    </div>
  );
}

function ActionsCell({ props, actions }: { props: ConnectionRowProps; actions: Actions }) {
  const label = useActionLabel(actions);
  const primary = props.status.action;
  const prominent =
    props.status.value === "action" || primary?.kind === "enable" || primary?.kind === "connect";
  const variant = prominent ? "primary" : "secondary";
  const items = props.menu.map((item) => ({
    label: item.label,
    danger: item.danger,
    onSelect: () => actions.act(item),
  }));
  let button: ReactNode = null;
  if (primary !== null && actions.isLink(primary) && primary.href !== undefined) {
    button = (
      <ButtonLink href={primary.href} variant={variant} size="sm" className="@max-[559px]:flex-1">
        {primary.label}
      </ButtonLink>
    );
  } else if (primary !== null) {
    button = (
      <Button
        variant={variant}
        size="sm"
        disabled={actions.busy}
        onClick={() => actions.act(primary)}
        className="@max-[559px]:flex-1"
      >
        {label(primary)}
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-2 @min-[560px]:@max-[819px]:col-span-2 @min-[820px]:justify-end">
      {button}
      {items.length > 0 && <ActionMenu label={props.name} items={items} />}
    </div>
  );
}

function Notice({ notice, actions }: { notice: ConnectionRowProps["notice"]; actions: Actions }) {
  if (notice === null) return null;
  const action = notice.action;
  return (
    <p
      role="status"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border px-4 py-2.5 text-sm text-warn"
    >
      <span>{notice.text}</span>
      {action !== null && (
        <LinkButton disabled={actions.busy} onClick={() => actions.act(action)}>
          {action.label}
        </LinkButton>
      )}
    </p>
  );
}

function HistoryEntry({ item }: { item: HistoryItem }) {
  const text = useTranslations("settings.connections");
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 py-1.5 @min-[560px]:grid-cols-[9.5rem_7rem_minmax(0,1fr)]">
      <time dateTime={item.at} className="text-muted">
        {item.when}
      </time>
      <span className={cn("font-medium", TONE_TEXT[OUTCOME_TONE[item.outcome]])}>
        {text(`history.${item.outcome}`)}
      </span>
      <span className="col-span-2 break-words @min-[560px]:col-span-1">
        {item.text}
        {item.byYou && <span className="text-muted"> · {text("history.byYou")}</span>}
      </span>
    </li>
  );
}

function History({ props, open, listId }: { props: ConnectionRowProps; open: boolean; listId: string }) {
  const text = useTranslations("settings.connections");
  if (props.history === null) return null;
  return (
    <div id={listId} hidden={!open} className="border-t border-border px-4 py-2.5 text-sm">
      {props.history.length === 0 ? (
        <p className="text-muted">{text("history.empty")}</p>
      ) : (
        <ol aria-label={text("history.label", { name: props.name })} className="flex flex-col">
          {props.history.map((item) => (
            <HistoryEntry key={item.at} item={item} />
          ))}
        </ol>
      )}
      {props.historyMore !== null && (
        <a
          href={props.historyMore}
          className="focus-ring mt-1 inline-flex h-6 items-center rounded-xs font-medium text-accent hover:underline"
        >
          {text("history.all")}
        </a>
      )}
    </div>
  );
}

function FullRow({ props, actions }: { props: ConnectionRowProps; actions: Actions }) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  return (
    <div
      aria-busy={actions.pending}
      data-testid="connection-row"
      data-status={props.status.value}
      className="@container flex flex-col"
    >
      <div className="grid grid-cols-1 gap-x-5 gap-y-2.5 px-4 py-3.5 @min-[560px]:@max-[819px]:grid-cols-2 @min-[820px]:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_176px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2">
            <Dot value={props.status.value} />
            <span className="min-w-0 font-semibold break-words">{props.name}</span>
            <StatusWord value={props.status.value} />
          </div>
          {props.detail !== null && <p className="mt-0.5 text-sm break-words text-muted">{props.detail}</p>}
        </div>
        <StateCell props={props} open={open} listId={listId} onToggle={() => setOpen((value) => !value)} />
        <ActionsCell props={props} actions={actions} />
      </div>
      <Notice notice={props.notice} actions={actions} />
      <Failure failure={actions.failure} compact={false} />
      <History props={props} open={open} listId={listId} />
    </div>
  );
}

export function ConnectionRow({
  run,
  ...rest
}: ConnectionRowProps & RowOptions & { run: RunConnectionAction }) {
  const { handled, onAction, disabled, compact = false, ...props } = rest;
  const actions = useRowActions(props.id, run, { handled, onAction, disabled });
  useRefreshWhileRunning(props.status.value);
  return compact ? (
    <CompactRow status={props.status} actions={actions} />
  ) : (
    <FullRow props={props} actions={actions} />
  );
}
