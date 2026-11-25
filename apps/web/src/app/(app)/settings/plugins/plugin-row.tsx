"use client";

// The row of a plugin on the web (PERS-615 §3): the row of `packages/ui` with what each of its actions
// does — «Activate», a page, the action of the connection that needs the person most, «Deactivate…».
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button, ButtonLink } from "@ledgerly/ui/button";
import { PluginRow as Row, type PluginRowProps } from "@ledgerly/ui/plugin-row";
import { useRouter } from "@ledgerly/ui/router";
import { notify } from "@ledgerly/ui/toast";
import { useActivate } from "./activate-button";
import { useRunConnection } from "./connection-row";
import { useDeactivate } from "./deactivate-dialogs";

/** The main action, as the server decides it: a step of the plugin, a page, or a connection's action. */
export type RowPrimary =
  | { kind: "activate"; label: string }
  | { kind: "link"; label: string; href: string; strong: boolean }
  | { kind: "run"; label: string; connectionId: string; action: string; strong: boolean }
  | null;

/** Does one action to one connection, and says a refusal in place. */
function useRun() {
  const text = useTranslations("settings.plugins");
  const router = useRouter();
  const run = useRunConnection();
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  function start(connectionId: string, kind: string) {
    setFailure(null);
    startTransition(async () => {
      const result = await run(connectionId, kind).catch(() => null);
      if (result === null) return setFailure(text("errors.failed"));
      if (!result.ok) return setFailure(result.message);
      if (result.toast !== null) notify(result.toast);
      router.refresh();
    });
  }
  return { start, pending, failure };
}

const said = (failure: string | null) =>
  failure === null ? null : (
    <p role="alert" className="text-sm text-neg">
      {failure}
    </p>
  );

/** The main action of a plugin, on its row and in the banner of its page. */
export function PrimaryAction({ primary, slug, name }: { primary: RowPrimary; slug: string; name: string }) {
  const run = useRun();
  const { activate, pending: activating, failure } = useActivate(slug, name);
  if (primary === null) return null;
  let button;
  if (primary.kind === "activate") {
    button = (
      <Button size="sm" disabled={activating} aria-busy={activating} onClick={activate}>
        {primary.label}
      </Button>
    );
  } else if (primary.kind === "link") {
    button = (
      <ButtonLink href={primary.href} size="sm" variant={primary.strong ? "primary" : "secondary"}>
        {primary.label}
      </ButtonLink>
    );
  } else {
    const { connectionId, action } = primary;
    button = (
      <Button
        size="sm"
        variant={primary.strong ? "primary" : "secondary"}
        disabled={run.pending}
        aria-busy={run.pending}
        onClick={() => run.start(connectionId, action)}
      >
        {primary.label}
      </Button>
    );
  }
  return (
    <span className="flex flex-col gap-1.5">
      {button}
      {failure}
      {said(run.failure)}
    </span>
  );
}

interface Props extends Omit<PluginRowProps, "primary" | "menu" | "children"> {
  primary: RowPrimary;
  /** The connection «Update now» of the menu reads; null without one. */
  update: string | null;
  deactivable: boolean;
}

export function PluginRow({ primary, update, deactivable, ...row }: Props) {
  const text = useTranslations("settings.plugins");
  const actions = useTranslations("settings.connections.actions");
  const router = useRouter();
  const run = useRun();
  const deactivate = useDeactivate({ slug: row.slug, provider: row.name });

  const items: PluginRowProps["menu"]["items"] = [
    { label: text("actions.open"), onSelect: () => router.push(row.href) },
  ];
  if (update !== null) items.push({ label: actions("update"), onSelect: () => run.start(update, "update") });
  if (deactivable) items.push({ label: text("actions.deactivate"), onSelect: deactivate.open, danger: true });

  const failures = [said(run.failure), deactivate.failure].filter((one) => one !== null);
  return (
    <Row
      {...row}
      primary={primary === null ? null : <PrimaryAction primary={primary} slug={row.slug} name={row.name} />}
      menu={{ label: text("actions.more", { name: row.name }), items }}
    >
      {failures.length > 0 && <div className="border-t border-border px-4 py-2.5">{failures}</div>}
      {deactivate.dialogs}
    </Row>
  );
}
