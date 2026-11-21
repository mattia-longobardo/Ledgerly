"use client";

// Step 4 of "Add pension fund" (screens §3): what will be created, each group with its Edit.
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { parseAmount } from "@ledgerly/domain/platform/format";
import { isCivilDate } from "@ledgerly/domain/shared/dates";
import { formatDate, formatMoney, type NumberFormat, type UiLocale } from "@ledgerly/domain/platform/format";
import type { SourceKind } from "@ledgerly/domain/funds/client";
import { LinkButton } from "@ledgerly/ui/button";
import { feeAmountText } from "./fee-text";
import { sourceSummary } from "./source-text";
import type { Draft, WizardStep } from "./wizard-draft";

interface ReviewProps {
  draft: Draft;
  /** The user's display currency: the fund's is said only when it is another. */
  currency: string;
  accounts: readonly { id: string; name: string }[];
  format: NumberFormat;
  locale: UiLocale;
  sourceOn: (kind: SourceKind) => boolean;
  onEdit: (step: Exclude<WizardStep, "review">) => void;
}

/** A group of the review: its title, its Edit, and its lines. */
function Group({
  name,
  title,
  onEdit,
  children,
}: {
  name: Exclude<WizardStep, "review">;
  title: string;
  onEdit: ReviewProps["onEdit"];
  children: ReactNode;
}) {
  const text = useTranslations("funds.wizard");
  return (
    <div className="flex flex-col gap-1 border-t border-border pt-3 first:border-t-0 first:pt-0">
      <dt className="flex items-center justify-between gap-3">
        <span className="font-medium">{title}</span>
        {/* A short word is narrower than a target may be: the button keeps 24 px of width. */}
        <LinkButton
          className="min-w-6 justify-center"
          aria-label={`${text("review.edit")}: ${title}`}
          onClick={() => onEdit(name)}
        >
          {text("review.edit")}
        </LinkButton>
      </dt>
      <dd className="text-sm break-words">{children}</dd>
    </div>
  );
}

/** The fund's fields that hold something, as "label: value". */
function useFundLines({ draft, currency, format, locale }: ReviewProps): [string, string][] {
  const text = useTranslations("funds.wizard");
  const money = (amount: string) => {
    try {
      return formatMoney(parseAmount(amount, format), format, { currency: draft.currency });
    } catch {
      return amount;
    }
  };
  const day = (date: string) => (isCivilDate(date) ? formatDate(date, "long", locale) : "");
  return [
    [text("fund.name"), draft.fund.name.trim()],
    [text("fund.provider"), draft.fund.provider.trim()],
    [text("fund.line"), draft.fund.compartment.trim()],
    [text("fund.memberSince"), day(draft.fund.startOn)],
    [
      text("fund.value"),
      draft.value.trim() === ""
        ? ""
        : text("review.valueLine", { value: money(draft.value), date: day(draft.valueOn) }),
    ],
    [text("fund.currency"), draft.currency === currency ? "" : draft.currency],
    [text("fund.code"), draft.fund.code.trim()],
  ];
}

/** One line per source switched on. */
function useSourceLines({ draft, accounts, format, locale, sourceOn }: ReviewProps): string[] {
  const sourceText = useTranslations("funds.sources");
  const accountName = accounts.find((account) => account.id === draft.debit.accountId)?.name ?? null;
  const summaryOptions = { format, locale, currency: draft.currency };
  return [
    sourceOn("payroll")
      ? `${sourceText("kinds.payroll")}: ${sourceSummary(sourceText, draft.payroll, summaryOptions)}`
      : null,
    sourceOn("bank_debit")
      ? `${sourceText("kinds.bank_debit")}: ${sourceSummary(sourceText, draft.debit, { ...summaryOptions, accountName })}`
      : null,
    sourceOn("manual") ? sourceText("kinds.manual") : null,
  ].filter((line) => line !== null);
}

export function WizardReview(props: ReviewProps) {
  const text = useTranslations("funds.wizard");
  const feeText = useTranslations("funds.fees");
  const { draft, format, onEdit } = props;
  const fundLines = useFundLines(props);
  const sourceLines = useSourceLines(props);
  return (
    <dl className="flex flex-col gap-3">
      <Group name="fund" title={text("review.fund")} onEdit={onEdit}>
        <ul className="flex flex-col gap-0.5">
          {fundLines
            .filter(([, value]) => value !== "")
            .map(([label, value]) => (
              <li key={label}>
                <span className="text-muted">{label}:</span> {value}
              </li>
            ))}
        </ul>
      </Group>
      <Group name="sources" title={text("review.sources")} onEdit={onEdit}>
        {sourceLines.length === 0 ? (
          <p className="text-muted">{text("review.noSources")}</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {sourceLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </Group>
      <Group name="fees" title={text("review.fees")} onEdit={onEdit}>
        {draft.fees.length === 0 ? (
          <p className="text-muted">{text("review.noFees")}</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {draft.fees.map((fee, index) => (
              <li key={`${index}-${fee.label}`}>
                {fee.label} · {feeAmountText(feeText, fee, format, draft.currency)}
              </li>
            ))}
          </ul>
        )}
      </Group>
    </dl>
  );
}
