"use client";

// The step «Account» of the switch (ux/n4-account-switch.md §4), read from
// `GET /accounts/{id}/switch/candidates`: the accounts of the person's banks in the account's
// currency, each with whether its IBAN is the account's own. A plain form: «Next» opens «Check».
import { useTranslations } from "next-intl";
import { accountSwitch } from "@ledgerly/api-contract/accounts";
import type { RouteOutput } from "@ledgerly/api-client";
import { Badge } from "@ledgerly/ui/badge";
import { Button, ButtonLink } from "@ledgerly/ui/button";
import { Card } from "@ledgerly/ui/card";
import { useApi } from "@ledgerly/ui/data";
import { Loaded } from "@ledgerly/ui/loaded";
import { EmptyState } from "@ledgerly/ui/states";

type Banks = RouteOutput<typeof accountSwitch.listSwitchCandidates>["banks"];

interface ChoicesProps {
  account: { id: string; name: string; currency: string };
  /** Where «Cancel» goes, and where the form sends its choice. */
  settings: string;
  here: string;
}

/** The bank's identifier of each choice, masked (`IT60 •••• 3456`), by `connectionId:bankAccountId`. */
type Masked = Map<string, string | null>;

export function SwitchChoices(props: ChoicesProps) {
  const input = { params: { id: props.account.id } };
  const read = useApi(accountSwitch.listSwitchCandidates, input);
  // Only the web's own session reads the masked identifiers (scope `session`, H45).
  const identifiers = useApi(accountSwitch.listSwitchIdentifiers, input);
  return (
    <Loaded state={read}>
      {(answer) => (
        <Loaded state={identifiers}>
          {(masked) => (
            <Choices
              {...props}
              banks={answer.banks}
              masked={
                new Map(
                  masked.identifiers.map((one) => [`${one.connectionId}:${one.bankAccountId}`, one.masked]),
                )
              }
            />
          )}
        </Loaded>
      )}
    </Loaded>
  );
}

function Choices({
  account,
  settings,
  here,
  masked,
  banks,
}: ChoicesProps & { banks: Banks; masked: Masked }) {
  const text = useTranslations("accounts.switch");
  const choices = banks.flatMap((bank) => bank.accounts);
  if (choices.length === 0) return <NoChoice banks={banks.length} currency={account.currency} />;
  const allowed = choices.filter((choice) => !choice.otherIban);
  const preselected =
    choices.find((choice) => choice.sameIban) ?? (allowed.length === 1 ? allowed[0] : undefined);
  return (
    <Card>
      <form method="get" action={here} className="flex flex-col gap-3.5">
        <input type="hidden" name="step" value="check" />
        <fieldset className="flex flex-col gap-3">
          <legend className="text-xl font-semibold">
            {text("account.question", { account: account.name })}
          </legend>
          <p className="text-sm text-muted">{text("account.explain", { currency: account.currency })}</p>
          {banks.map((bank) => (
            <fieldset key={bank.connectionId} className="flex flex-col gap-1.5">
              <legend className="font-medium">{bank.bank}</legend>
              {bank.expired && (
                <p className="text-sm text-warn">{text("account.expired", { bank: bank.bank })}</p>
              )}
              {bank.accounts.map((choice) => {
                const value = `${bank.connectionId}:${choice.bankAccountId}`;
                return (
                  <Choice
                    key={value}
                    value={value}
                    choice={choice}
                    masked={masked.get(value) ?? null}
                    disabled={bank.expired || choice.otherIban}
                    preselected={preselected === choice}
                  />
                );
              })}
            </fieldset>
          ))}
        </fieldset>
        <div className="flex justify-end gap-2 max-[480px]:flex-col-reverse">
          <ButtonLink href={settings}>{text("actions.cancel")}</ButtonLink>
          <Button type="submit" variant="primary">
            {text("account.start")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** No bank connected, or no account of theirs free in the account's currency. */
function NoChoice({ banks, currency }: { banks: number; currency: string }) {
  const text = useTranslations("accounts.switch");
  return banks === 0 ? (
    <EmptyState
      title={text("account.noBank")}
      description={text("account.noBankText")}
      actions={<ButtonLink href="/banks/connect">{text("account.connect")}</ButtonLink>}
    />
  ) : (
    <EmptyState
      title={text("account.noFree")}
      description={text("account.noFreeText", { currency })}
      actions={<ButtonLink href="/settings/integrations">{text("account.integrations")}</ButtonLink>}
    />
  );
}

/** One account of a bank: its name, masked identifier and currency, and why it cannot be chosen. */
function Choice({
  value,
  choice,
  masked,
  disabled,
  preselected,
}: {
  value: string;
  choice: Banks[number]["accounts"][number];
  masked: string | null;
  disabled: boolean;
  preselected: boolean;
}) {
  const text = useTranslations("accounts.switch");
  const reason = `why-${choice.bankAccountId}`;
  return (
    <label className="flex min-h-6 flex-wrap items-center gap-2 text-sm">
      <input
        type="radio"
        name="t"
        value={value}
        required
        disabled={disabled}
        defaultChecked={preselected && !disabled}
        aria-describedby={disabled ? reason : undefined}
      />
      <span className="break-words">
        {[choice.name ?? text("account.unnamed"), masked, choice.currency]
          .filter((part) => part !== null)
          .join(" · ")}
      </span>
      {choice.sameIban && <Badge tone="pos">{text("account.sameIban")}</Badge>}
      {choice.here !== null && (
        <Badge tone="neutral">{text("account.alreadyHere", { account: choice.here.name })}</Badge>
      )}
      {choice.otherIban && (
        <span id={reason} className="text-muted">
          {text("account.otherIban")}
        </span>
      )}
    </label>
  );
}
