"use client";

// One step of "Add pension fund" (screens §3): its heading, its fields, and Back or Cancel beside
// the step's own command. Every step is in the form; only the one of the address is shown.
import type { ComponentProps, ReactNode, RefObject } from "react";
import { useTranslations } from "next-intl";
import { Button, ButtonLink } from "@ledgerly/ui/button";
import { Card } from "@ledgerly/ui/card";
import type { WizardStep } from "./wizard-draft";

/** The step's own command, and Cancel on step 1 or Back on the others. */
function SectionCommands({
  name,
  pending,
  primary,
  home,
  onBack,
}: {
  name: WizardStep;
  pending: boolean;
  primary: string;
  home: ComponentProps<typeof ButtonLink>["href"];
  onBack: () => void;
}) {
  const text = useTranslations("funds.wizard");
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3 min-[480px]:flex-row-reverse min-[480px]:justify-between">
      <Button type="submit" variant="primary" disabled={pending}>
        {primary}
      </Button>
      {name === "fund" ? (
        <ButtonLink href={home} variant="ghost">
          {text("cancel")}
        </ButtonLink>
      ) : (
        <Button variant="ghost" disabled={pending} onClick={onBack}>
          {text("back")}
        </Button>
      )}
    </div>
  );
}

export function WizardSection({
  name,
  step,
  id,
  intro,
  templateName,
  failure,
  alertRef,
  pending,
  primary,
  home,
  onBack,
  children,
}: {
  name: WizardStep;
  step: WizardStep;
  id: string;
  intro: string | null;
  /** The template the sources and fees came from, said on steps 2 and 3. */
  templateName: string | null;
  /** Why "Create fund" failed, on the last step. */
  failure: string | null;
  alertRef: RefObject<HTMLParagraphElement | null>;
  pending: boolean;
  primary: string;
  /** Where Cancel goes, from step 1. */
  home: ComponentProps<typeof ButtonLink>["href"];
  onBack: () => void;
  children: ReactNode;
}) {
  const text = useTranslations("funds.wizard");
  return (
    <Card
      hidden={step !== name}
      data-testid={`wizard-step-${name}`}
      className={step === name ? "flex flex-col gap-4" : undefined}
    >
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-heading-${name}`} tabIndex={-1} className="text-lg font-semibold outline-none">
          {text(`steps.${name}`)}
        </h2>
        {intro && <p className="text-muted">{intro}</p>}
      </div>
      {name !== "fund" && name !== "review" && templateName !== null && (
        <p className="text-sm text-muted">{text("fromTemplate", { model: templateName })}</p>
      )}
      {children}
      {name === "review" && failure && (
        <p ref={alertRef} role="alert" tabIndex={-1} className="text-sm text-neg">
          {failure}
        </p>
      )}
      <SectionCommands name={name} pending={pending} primary={primary} home={home} onBack={onBack} />
    </Card>
  );
}
