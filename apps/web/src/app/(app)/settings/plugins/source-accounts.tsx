"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@ledgerly/ui/button";
import { Checkbox } from "@ledgerly/ui/input";
import { Modal } from "@ledgerly/ui/modal";
import { notify } from "@ledgerly/ui/toast";
import { chooseCoreAccounts, type CoreAccountRow, coreAccounts } from "./core-calls";
import { useRefusalText } from "./source-card";

/** The accounts of the source in the dialog: one here stays chosen, the others can be chosen. */
function ChoiceList(props: {
  choices: CoreAccountRow[] | null;
  picked: ReadonlySet<string>;
  error: string | null;
  pending: boolean;
  toggle: (externalId: string, chosen: boolean) => void;
}) {
  const text = useTranslations("settings.integrations");
  const { choices, picked, error, pending, toggle } = props;
  return (
    <div className="flex flex-col gap-2">
      {error && (
        <p role="alert" className="text-sm text-neg">
          {error}
        </p>
      )}
      {choices === null && !error && <p className="text-sm text-muted">{text("choose.loading")}</p>}
      {choices !== null && choices.length === 0 && (
        <p className="text-sm text-muted">{text("choose.none")}</p>
      )}
      {choices?.map((one) => (
        <div key={one.externalId} className="flex flex-col">
          <Checkbox
            label={one.name}
            checked={one.here !== null || picked.has(one.externalId)}
            disabled={one.here !== null || pending}
            onChange={(event) => toggle(one.externalId, event.target.checked)}
          />
          <span className="pl-5 text-sm text-muted">
            {one.here !== null ? text("choose.here", { account: one.here }) : text("choose.notHere")}
          </span>
        </div>
      ))}
    </div>
  );
}

/** The state of the choice: the accounts read when it opens, the ones picked, and the two calls. */
function useAccountChoice(connectionId: string) {
  const text = useTranslations("settings.integrations");
  const [choosing, setChoosing] = useState(false);
  const [choices, setChoices] = useState<CoreAccountRow[] | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // The page draws the connection from its server render until it reads `/api/v1` itself.
  const router = useRouter();
  const refusal = useRefusalText();

  const attempt = (work: () => Promise<void>) =>
    startTransition(async () => {
      try {
        await work();
      } catch {
        setError(text("errors.failed"));
      }
    });
  const open = () => {
    setChoosing(true);
    setChoices(null);
    attempt(async () => {
      const result = await coreAccounts(connectionId);
      if (!result.ok) return setError(refusal(result.error));
      setChoices(result.accounts);
      setPicked(new Set(result.accounts.filter((one) => one.chosen).map((one) => one.externalId)));
    });
  };
  const save = () =>
    attempt(async () => {
      const all = (choices ?? []).map((one) => one.externalId);
      const result = await chooseCoreAccounts(connectionId, all, picked);
      if (!result.ok) return setError(refusal(result.error));
      setError(null);
      setChoosing(false);
      notify(text("toasts.chosen"));
      router.refresh();
    });
  const toggle = (externalId: string, chosen: boolean) =>
    setPicked((before) => {
      const next = new Set(before);
      if (chosen) next.add(externalId);
      else next.delete(externalId);
      return next;
    });
  return { choosing, setChoosing, choices, picked, error, pending, open, save, toggle };
}

/**
 * "Accounts" on the page of a source read with a token (plugin-settings.md §2.2): which of its
 * accounts come into Ledgerly. The list is the source's own, read when the person asks for it: the
 * page never calls the source by itself.
 */
export function SourceAccounts({ connectionId }: { connectionId: string }) {
  const text = useTranslations("settings.integrations");
  const plugin = useTranslations("settings.plugin");
  const choice = useAccountChoice(connectionId);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
      <p className="text-sm text-muted">{plugin("accounts.chooseHint")}</p>
      <Button size="sm" disabled={choice.pending} onClick={choice.open}>
        {plugin("accounts.choose")}
      </Button>
      <Modal
        open={choice.choosing}
        onOpenChange={(open) => !open && choice.setChoosing(false)}
        title={text("choose.title")}
        description={text("choose.description")}
        width={460}
        footer={
          <>
            <Button size="sm" onClick={() => choice.setChoosing(false)}>
              {text("choose.cancel")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={choice.pending || choice.choices === null}
              onClick={choice.save}
            >
              {text("choose.save")}
            </Button>
          </>
        }
      >
        <ChoiceList {...choice} />
      </Modal>
    </div>
  );
}
