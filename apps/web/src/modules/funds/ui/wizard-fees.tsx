"use client";

// Step 3 of "Add pension fund" (screens §3): the fees, each applying to the fund, a source, or a
// component of the payslip source.
import { useTranslations } from "next-intl";
import type { CivilDate } from "@ledgerly/domain/shared/dates";
import type { NumberFormat, UiLocale } from "@ledgerly/domain/platform/format";
import { SOURCE_KINDS, type SourceKind } from "@ledgerly/domain/funds/client";
import { FeeManager } from "./fee-list";
import type { FeeScopeOption } from "./fee-text";
import type { Draft } from "./wizard-draft";

/** What "Applies to" offers: the sources switched on, and the components of the payslip one. */
function useScopes(draft: Draft, sourceOn: (kind: SourceKind) => boolean): FeeScopeOption[] {
  const sourceText = useTranslations("funds.sources");
  const feeText = useTranslations("funds.fees");
  return SOURCE_KINDS.filter(sourceOn).flatMap((kind) => [
    { value: kind, label: sourceText(`kinds.${kind}`) },
    ...(kind === "payroll"
      ? draft.payroll.components.map((component) => ({
          value: `payroll:${component}`,
          label: feeText("scope.component", {
            source: sourceText("kinds.payroll"),
            component: sourceText(`components.${component}`),
          }),
        }))
      : []),
  ]);
}

export function FeesStep({
  draft,
  sourceOn,
  todayOn,
  format,
  locale,
  choose,
}: {
  draft: Draft;
  sourceOn: (kind: SourceKind) => boolean;
  todayOn: CivilDate;
  format: NumberFormat;
  locale: UiLocale;
  choose: (patch: Partial<Draft>) => void;
}) {
  const text = useTranslations("funds.wizard");
  return (
    <FeeManager
      fees={draft.fees}
      scopes={useScopes(draft, sourceOn)}
      todayOn={todayOn}
      format={format}
      locale={locale}
      currency={draft.currency}
      onSave={(fee, index) => {
        choose({
          fees:
            index === null
              ? [...draft.fees, fee]
              : draft.fees.map((one, place) => (place === index ? fee : one)),
        });
        return null;
      }}
      onRemove={(_fee, index) => choose({ fees: draft.fees.filter((_one, place) => place !== index) })}
      empty={(add) => (
        <>
          <p className="text-sm text-muted">{text("fees.empty")}</p>
          <div>{add}</div>
        </>
      )}
    />
  );
}
