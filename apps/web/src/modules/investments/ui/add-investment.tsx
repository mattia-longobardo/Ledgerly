"use client";

// «Add investment» (rewrite plan R5b, decisions B1c and ST-3): one dialog of three choices in place of
// the catalog and its «Coming soon». «Connect a service» lists the providers of
// `GET /investments/catalog`, which has no provider to come; «Account with value only» makes the
// service of a value typed by hand; «Manual portfolio» one of cash and positions typed by hand (R5d);
// «Pension fund» opens the steps of a new fund.
import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useRef, useState } from "react";
import { investments } from "@ledgerly/api-contract/investments";
import { profile } from "@ledgerly/api-contract/settings";
import type { RouteOutput } from "@ledgerly/api-client";
import { numberStyle } from "@ledgerly/format/format";
import { Button, ButtonLink } from "@ledgerly/ui/button";
import { useApi } from "@ledgerly/ui/data";
import { Loaded } from "@ledgerly/ui/loaded";
import { Modal } from "@ledgerly/ui/modal";
import { Link } from "@ledgerly/ui/router";
import { ConnectDialog, type ConnectableProvider } from "./connect";
import { ValueAccountDialog } from "./manual-service";

/** The address of «Pension fund»: the steps of a new fund. */
const NEW_FUND_HREF = "/investments/new-fund";
/** The catalog's entry of the value typed by hand: «Account with value only» is its choice. */
const MANUAL = "manual";

type Catalog = RouteOutput<typeof investments.getInvestmentsCatalog>;
type Provider = Catalog["providers"][number];
type Step = "choose" | "connect" | "value" | "portfolio" | { provider: ConnectableProvider };

const CHOICE =
  "focus-ring flex w-full flex-col items-start gap-0.5 rounded-md border border-border p-3 text-left hover:bg-hover";

function Choice({ title, description }: { title: string; description: string }) {
  return (
    <>
      <span className="font-medium">{title}</span>
      <span className="text-sm text-muted">{description}</span>
    </>
  );
}

/** The three choices. */
function ChooseDialog({ onClose, onPick }: { onClose: () => void; onPick: (step: Step) => void }) {
  const text = useTranslations("investments.add");
  return (
    <Modal open onOpenChange={(open) => !open && onClose()} title={text("title")} width={520}>
      <ul className="flex flex-col gap-2">
        <li>
          <button type="button" className={CHOICE} onClick={() => onPick("connect")}>
            <Choice title={text("connect")} description={text("connectDescription")} />
          </button>
        </li>
        <li>
          <button type="button" className={CHOICE} onClick={() => onPick("value")}>
            <Choice title={text("value")} description={text("valueDescription")} />
          </button>
        </li>
        <li>
          <button type="button" className={CHOICE} onClick={() => onPick("portfolio")}>
            <Choice title={text("portfolio")} description={text("portfolioDescription")} />
          </button>
        </li>
        <li>
          <Link href={NEW_FUND_HREF} className={CHOICE} onClick={onClose}>
            <Choice title={text("fund")} description={text("fundDescription")} />
          </Link>
        </li>
      </ul>
    </Modal>
  );
}

/** A provider of «Connect a service»: its service when linked, «Connect» when it can be, its site. */
function ProviderRow({ provider, onConnect }: { provider: Provider; onConnect: (one: Provider) => void }) {
  const text = useTranslations("investments");
  const linked = provider.connected;
  return (
    <li
      data-testid="provider-row"
      className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2 last:border-0"
    >
      <span className="flex min-w-0 flex-col">
        <span className="font-medium">{provider.name}</span>
        <span className="text-sm text-muted">
          {linked.length > 0
            ? text("catalog.linked", { names: linked.map((one) => one.name).join(", ") })
            : text("catalog.connectDescription")}
        </span>
      </span>
      <span className="flex items-center gap-2">
        {provider.url && (
          <a
            href={provider.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={text("actions.openSite", { name: provider.name })}
            className="focus-ring inline-flex min-h-6 items-center gap-1 rounded-sm text-sm text-accent hover:underline"
          >
            {text("actions.openSiteShort")}
            <ExternalLink aria-hidden className="size-3.5" />
          </a>
        )}
        {linked.length === 1 ? (
          <ButtonLink href={`/investments/${linked[0].accountId}`} size="sm">
            {text("actions.open")}
          </ButtonLink>
        ) : (
          linked.length === 0 &&
          provider.connect === "apikey" && (
            <Button size="sm" variant="primary" onClick={() => onConnect(provider)}>
              {text("connect.open")}
            </Button>
          )
        )}
      </span>
    </li>
  );
}

/** «Connect a service»: the providers that can be connected, and the ones already linked. */
function ConnectList({
  catalog,
  onClose,
  onBack,
  onConnect,
}: {
  catalog: ReturnType<typeof useApi<typeof investments.getInvestmentsCatalog>>;
  onClose: () => void;
  onBack: () => void;
  onConnect: (one: Provider) => void;
}) {
  const text = useTranslations("investments.add");
  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={text("connect")}
      description={text("connectDescription")}
      width={520}
      footer={<Button onClick={onBack}>{text("back")}</Button>}
    >
      <Loaded state={catalog}>
        {(view) => (
          <ul className="flex flex-col">
            {view.providers
              .filter((provider) => provider.id !== MANUAL)
              .map((provider) => (
                <ProviderRow key={provider.id} provider={provider} onConnect={onConnect} />
              ))}
          </ul>
        )}
      </Loaded>
    </Modal>
  );
}

/** The flow, mounted while open: the catalog and the number format are read once, for every step. */
function AddFlow({
  step,
  setStep,
  onClose,
}: {
  step: Step;
  setStep: (step: Step) => void;
  onClose: () => void;
}) {
  const text = useTranslations("investments.add");
  const preferences = useApi(profile.getPreferences, {});
  const catalog = useApi(investments.getInvestmentsCatalog, {});
  if (step === "choose") return <ChooseDialog onClose={onClose} onPick={setStep} />;
  if (step === "connect")
    return (
      <ConnectList
        catalog={catalog}
        onClose={onClose}
        onBack={() => setStep("choose")}
        onConnect={(provider) => setStep({ provider })}
      />
    );
  const ready = (draw: (view: Catalog, prefs: NonNullable<typeof preferences.data>) => ReactNode) =>
    catalog.data && preferences.data ? (
      draw(catalog.data, preferences.data)
    ) : (
      <Modal open onOpenChange={(open) => !open && onClose()} title={text("title")}>
        {catalog.data ? (
          <Loaded state={preferences}>{() => null}</Loaded>
        ) : (
          <Loaded state={catalog}>{() => null}</Loaded>
        )}
      </Modal>
    );
  if (step === "value" || step === "portfolio")
    return ready((view, prefs) => (
      <ValueAccountDialog
        kind={step}
        onClose={onClose}
        existing={view.existing}
        numberFormat={numberStyle(prefs)}
        currency={prefs.displayCurrency}
      />
    ));
  return ready((view, prefs) => (
    <ConnectDialog
      onClose={onClose}
      provider={step.provider}
      existing={view.existing}
      numberFormat={numberStyle(prefs)}
    />
  ));
}

/** «Add investment»: the button and, while open, its dialog. */
export function AddInvestmentButton({ size }: { size?: "sm" }) {
  const text = useTranslations("investments.add");
  const [step, setStep] = useState<Step | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const close = () => {
    setStep(null);
    opener.current?.focus();
  };
  return (
    <>
      <Button ref={opener} variant="primary" size={size} onClick={() => setStep("choose")}>
        {text("open")}
      </Button>
      {step !== null && <AddFlow step={step} setStep={setStep} onClose={close} />}
    </>
  );
}
