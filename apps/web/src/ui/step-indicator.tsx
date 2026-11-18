import { Check } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { cn } from "./cn";

export interface Step {
  id: string;
  label: string;
  /** Where a step already done leads back to. */
  href: Route;
}

/**
 * The steps of a procedure, in a row: the current one carries `aria-current="step"`, the ones
 * before it are links back to themselves with a check mark. Below 480 px a step that is not the
 * current one shows its number only; its name stays for a screen reader.
 */
export function StepIndicator({
  label,
  steps,
  current,
  doneLabel,
}: {
  label: string;
  steps: readonly Step[];
  current: string;
  /** Read after the name of a step already done ("done"). */
  doneLabel: string;
}) {
  const at = steps.findIndex((step) => step.id === current);
  return (
    <ol aria-label={label} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      {steps.map((step, index) => {
        const isCurrent = index === at;
        const done = index < at;
        const body = (
          <>
            {/* The spaces are for the name a screen reader says: a flex row draws none of them. */}
            <span className="tabular-nums">{index + 1}</span>{" "}
            {done && <Check aria-hidden className="size-3.5" />}
            <span className={cn(!isCurrent && "max-[480px]:sr-only")}>{step.label}</span>{" "}
            {done && <span className="sr-only">{doneLabel}</span>}
          </>
        );
        return (
          <li
            key={step.id}
            aria-current={isCurrent ? "step" : undefined}
            className={cn("flex items-center", isCurrent ? "font-medium text-fg" : "text-muted")}
          >
            {done ? (
              <Link
                href={step.href}
                className="focus-ring inline-flex min-h-6 min-w-6 items-center gap-1.5 rounded-[4px] hover:text-fg"
              >
                {body}
              </Link>
            ) : (
              <span className="inline-flex min-h-6 items-center gap-1.5">{body}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
