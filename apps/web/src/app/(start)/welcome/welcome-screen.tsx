"use client";

// The first start (rewrite plan R5a, E4, E8, PA13), in three steps: «Country and format», proposed by
// the instance or the browser and then by the country's pack; the addons, none on until chosen; the
// first account, with its IBAN. The second step ends the first start (`POST /onboarding`); the
// account is the person's own choice, and the app opens either way.
import { useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useEffect, useRef, useState, useTransition } from "react";
import { type AddonId, ADDONS, ONBOARDING } from "@ledgerly/api-contract";
import { call } from "@ledgerly/api-client";
import { profile } from "@ledgerly/api-contract/settings";
import { Button } from "@ledgerly/ui/button";
import { Checkbox } from "@ledgerly/ui/input";
import { useApi } from "@ledgerly/ui/data";
import { Loaded } from "@ledgerly/ui/loaded";
import { BrandLockup } from "@ledgerly/ui/shell/brand";
import { NewAccountForm } from "@/modules/accounts/client";
import { type CountryPack, packOf } from "@/platform/country";
import { browserFacts, browserRegion, type Region, withCountry } from "./region";
import { RegionFields } from "./region-fields";

type Step = 1 | 2 | 3;

/** A full load: the root layout takes the new language, and the shell the addons chosen. */
const openApp = () => window.location.assign("/");

export function WelcomeScreen({ admin }: { admin: boolean }) {
  const text = useTranslations("welcome");
  const common = useTranslations("common");
  const onboarding = useApi(ONBOARDING.getOnboarding, {});
  const countries = useApi(ONBOARDING.listCountries, {});
  const options = useApi(profile.getProfileOptions, {});
  const [step, setStep] = useState<Step>(1);
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  // Each step moves the focus to its title, so a keyboard and a screen reader start there.
  useEffect(() => {
    if (first.current) first.current = false;
    else heading.current?.focus();
  }, [step]);

  return (
    <div className="flex w-full max-w-[560px] min-w-0 animate-in flex-col gap-5 rounded-modal border border-border bg-card p-6 sm:p-8">
      <BrandLockup name={common("product")} />
      <div>
        <p className="text-sm text-muted">{text("step", { step, steps: 3 })}</p>
        <h1
          ref={heading}
          tabIndex={-1}
          className="text-title leading-[1.2] font-semibold tracking-title outline-none"
        >
          {text(`steps.${step}.title`)}
        </h1>
        <p className="mt-1.5 text-muted">{text(`steps.${step}.description`)}</p>
      </div>
      <Loaded state={onboarding}>
        {({ proposal }) => (
          <Loaded state={countries}>
            {({ countries: packs }) => (
              <Loaded state={options}>
                {({ timeZones }) => (
                  <Steps
                    step={step}
                    setStep={setStep}
                    admin={admin && proposal === null}
                    proposal={proposal}
                    packs={packs}
                    timeZones={timeZones.map(({ zone, offset }) => ({
                      value: zone,
                      label: `${zone} (${offset})`,
                    }))}
                  />
                )}
              </Loaded>
            )}
          </Loaded>
        )}
      </Loaded>
    </div>
  );
}

interface StepsProps {
  step: Step;
  setStep: (step: Step) => void;
  /** The first admin: the choice also becomes the instance's defaults. */
  admin: boolean;
  proposal: Region | null;
  packs: readonly CountryPack[];
  timeZones: { value: string; label: string }[];
}

function Steps({ step, setStep, admin, proposal, packs, timeZones }: StepsProps) {
  const text = useTranslations("welcome");
  const [browser] = useState(() => browserRegion(browserFacts()));
  const [region, setRegion] = useState<Region>(
    () => proposal ?? withCountry(browser.country, packOf(packs, browser.country), browser),
  );
  const [addons, setAddons] = useState<AddonId[]>([]);
  const finish = useFinish(() => setStep(3));

  if (step === 1)
    return (
      <StepForm onSubmit={() => setStep(2)}>
        <RegionFields
          region={region}
          timeZones={timeZones}
          onChange={setRegion}
          onCountry={(country) => setRegion(withCountry(country, packOf(packs, country), browser))}
        />
        {admin && (
          <p className="text-sm text-muted" data-testid="instance-defaults">
            {text("instanceDefaults")}
          </p>
        )}
      </StepForm>
    );
  if (step === 2)
    return (
      <StepForm
        onSubmit={() => finish.run({ ...region, addons })}
        onBack={() => setStep(1)}
        pending={finish.pending}
      >
        {finish.failed && (
          <p role="alert" className="text-sm text-neg">
            {text("failed")}
          </p>
        )}
        <AddonChoice chosen={addons} onChange={setAddons} />
      </StepForm>
    );
  return (
    <NewAccountForm
      onCreated={openApp}
      cancel={
        <Button size="sm" onClick={openApp}>
          {text("skip")}
        </Button>
      }
    />
  );
}

/** `POST /onboarding`: it ends the first start with the region and the addons chosen. */
function useFinish(done: () => void) {
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  const run = (body: Region & { addons: AddonId[] }) =>
    startTransition(async () => {
      try {
        await call(ONBOARDING.completeOnboarding, { body });
        setFailed(false);
        done();
      } catch {
        setFailed(true);
      }
    });
  return { run, pending, failed };
}

/** One step: its fields, then Back when there is a step before, and Continue. */
function StepForm({
  children,
  onSubmit,
  onBack,
  pending = false,
}: {
  children: ReactNode;
  onSubmit: () => void;
  onBack?: () => void;
  pending?: boolean;
}) {
  const text = useTranslations("welcome");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };
  return (
    <form className="flex flex-col gap-5" onSubmit={submit}>
      {children}
      <div className="flex justify-between">
        {onBack ? <Button onClick={onBack}>{text("back")}</Button> : <span />}
        <Button type="submit" variant="primary" disabled={pending}>
          {text("next")}
        </Button>
      </div>
    </form>
  );
}

/** One box per addon, none ticked: no addon is on before the person chooses it (PA13). */
function AddonChoice({ chosen, onChange }: { chosen: AddonId[]; onChange: (addons: AddonId[]) => void }) {
  const text = useTranslations("welcome");
  const names = useTranslations("nav");
  const hints = useTranslations("settings.addons.items");
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="sr-only">{text("addons")}</legend>
      {ADDONS.map((id) => (
        <div key={id} className="flex flex-col">
          <Checkbox
            label={names(id)}
            checked={chosen.includes(id)}
            aria-describedby={`addon-${id}-hint`}
            data-testid={`addon-choice-${id}`}
            onChange={(event) =>
              onChange(event.target.checked ? [...chosen, id] : chosen.filter((one) => one !== id))
            }
          />
          <span id={`addon-${id}-hint`} className="pl-6 text-sm text-muted">
            {hints(id)}
          </span>
        </div>
      ))}
    </fieldset>
  );
}
