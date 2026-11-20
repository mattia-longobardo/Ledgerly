"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@ledgerly/ui/button";
import { ActionMenu } from "@ledgerly/ui/menu";
import { useRouter } from "@ledgerly/ui/router";
import { notify } from "@ledgerly/ui/toast";
import { setPocketState } from "../calls";
import { AddToPocketDialog } from "./add-to-pocket-dialog";
import type { DialogContext, PocketDetail } from "./dialog-context";
import { LinkExpenseDialog } from "./link-expense-dialog";
import { PlannedExpenseDialog } from "./planned-expense-dialog";
import { PocketDialog } from "./pocket-dialog";

type Dialog = "add" | "plan" | "link" | "edit" | "new" | null;

/**
 * The pocket's buttons and the dialogs they open. `place` decides which: the top bar of a pocket's
 * page has its two main actions (of the list, "New pocket"), the detail card every action plus the
 * state menu, the list a single "New pocket".
 */
export function PocketActions({
  place,
  pocket,
  context,
}: {
  place: "topbar" | "detail" | "new" | "empty";
  pocket: PocketDetail | null;
  context: DialogContext;
}) {
  const text = useTranslations("pockets");
  const router = useRouter();
  const [open, setOpen] = useState<Dialog>(null);
  const [, startTransition] = useTransition();
  const close = () => setOpen(null);

  function setState(state: "active" | "paused" | "archived", toast: string) {
    if (!pocket) return;
    startTransition(async () => {
      const result = await setPocketState(pocket.id, state);
      notify(result.ok ? toast : text("errors.failed"), result.ok ? "success" : "error");
      if (result.ok && state === "archived") router.push("/pockets");
    });
  }

  const movable = pocket !== null && pocket.state !== "archived";
  const standalone = pocket !== null && pocket.accountId === null;
  return (
    <>
      {place === "new" && (
        <button
          type="button"
          onClick={() => setOpen("new")}
          className="focus-ring flex h-10 items-center justify-center rounded-card border border-dashed border-border2 text-sm font-medium text-muted hover:bg-hover hover:text-fg"
        >
          + {text("list.new")}
        </button>
      )}
      {place === "empty" && (
        <Button variant="primary" onClick={() => setOpen("new")}>
          {text("empty.cta")}
        </Button>
      )}
      {place === "topbar" && movable && (
        <>
          <Button size="sm" onClick={() => setOpen("plan")}>
            {text("actions.plan")}
          </Button>
          <Button size="sm" variant="primary" onClick={() => setOpen("add")}>
            {text("actions.add")}
          </Button>
        </>
      )}
      {place === "topbar" && !movable && (
        <Button size="sm" variant="primary" onClick={() => setOpen("new")}>
          {text("list.new")}
        </Button>
      )}
      {place === "detail" && pocket && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="sm" onClick={() => setOpen("add")} disabled={!movable}>
            {text("actions.add")}
          </Button>
          <Button size="sm" onClick={() => setOpen("plan")} disabled={!movable}>
            {text("actions.plan")}
          </Button>
          {standalone && (
            <Button size="sm" onClick={() => setOpen("link")} disabled={!movable}>
              {text("actions.link")}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => setOpen("edit")}>
            {text("actions.edit")}
          </Button>
          <ActionMenu
            label={text("actions.more")}
            items={[
              pocket.state === "paused"
                ? {
                    label: text("actions.resume"),
                    onSelect: () => setState("active", text("toasts.resumed")),
                  }
                : { label: text("actions.pause"), onSelect: () => setState("paused", text("toasts.paused")) },
              {
                label: text("actions.archive"),
                onSelect: () => setState("archived", text("toasts.archived")),
                danger: true,
              },
            ]}
          />
        </div>
      )}

      {(open === "new" || open === "edit") && (
        <PocketDialog onClose={close} pocket={open === "edit" ? pocket : null} context={context} />
      )}
      {open === "add" && pocket && <AddToPocketDialog onClose={close} pocket={pocket} context={context} />}
      {open === "plan" && pocket && (
        <PlannedExpenseDialog onClose={close} pocket={pocket} context={context} />
      )}
      {open === "link" && pocket && <LinkExpenseDialog onClose={close} pocket={pocket} context={context} />}
    </>
  );
}
