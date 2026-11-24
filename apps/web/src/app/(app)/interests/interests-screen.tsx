"use client";

// Interests (spec §7.6, design), read from `/api/v1` (rewrite plan R3): one row per rule; the rule's
// page has its payouts and days. Every figure is a field of `GET /interests`; the screen formats it.
import { Link } from "@ledgerly/ui/router";
import { useTranslations } from "next-intl";
import { interests } from "@ledgerly/api-contract/interests";
import type { RouteOutput } from "@ledgerly/api-client";
import { parseCents } from "@ledgerly/format/cents";
import { formatDate, NULL_DISPLAY } from "@ledgerly/format/format";
import { Card } from "@ledgerly/ui/card";
import { cn } from "@ledgerly/ui/cn";
import { useApi } from "@ledgerly/ui/data";
import { Loaded } from "@ledgerly/ui/loaded";
import { Page } from "@ledgerly/ui/shell/page";
import { EmptyState } from "@ledgerly/ui/states";
import { Table, TBody, Td, Th, THead, Tr } from "@ledgerly/ui/table";
import {
  draftOf,
  type Format,
  formatRate,
  newDraft,
  type Rule,
  RuleButton,
  TierChips,
  useFormat,
  useTierChips,
} from "@/modules/interests/client";
import { useCountryPack } from "@/platform/country";

type View = RouteOutput<typeof interests.listInterestRules>;

interface Props {
  view: View;
  format: Format;
}

const accrued = (rule: Rule) => parseCents(rule.accruedYtd) > 0n;

function RuleRow({ rule, view, format }: Props & { rule: Rule }) {
  const text = useTranslations("interests");
  const chips = useTierChips(rule.tiers, format.numberFormat);
  return (
    <Tr className="h-11" data-testid="rule-row">
      <Td>
        <Link href={`/interests/${rule.id}`} className="focus-ring flex flex-col rounded-xs hover:underline">
          <span className="font-medium">{rule.account}</span>
          <span className="text-xs text-muted">
            {text("from", { date: formatDate(rule.validFrom, "long", format.locale) })}
          </span>
        </Link>
      </Td>
      <Td>
        <TierChips chips={chips} />
      </Td>
      <Td align="right" muted>
        {formatRate(rule.tax, format.numberFormat)}
      </Td>
      <Td muted className="text-sm">
        {text(`basis.${rule.dayCount}`)} · {text(`settlement.${rule.settlement}`)}
      </Td>
      <Td align="right" className={cn("font-medium", accrued(rule) ? "text-pos" : "text-muted")}>
        {accrued(rule) ? format.money(rule.accruedYtd) : NULL_DISPLAY}
      </Td>
      <Td muted>{rule.nextPayout ? formatDate(rule.nextPayout, "long", format.locale) : NULL_DISPLAY}</Td>
      <Td>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs font-medium",
            rule.state === "active" ? "bg-pos-bg text-pos" : "bg-hover text-muted",
          )}
        >
          {text(`state.${rule.state}`)}
        </span>
      </Td>
      <Td>
        <RuleButton
          draft={draftOf(rule, format.numberFormat)}
          accounts={view.accounts}
          label={text("columns.edit")}
          variant="ghost"
          size="xs"
        />
      </Td>
    </Tr>
  );
}

function RuleItem({ rule, format }: { rule: Rule; format: Format }) {
  const chips = useTierChips(rule.tiers, format.numberFormat);
  return (
    <li data-testid="rule-item" className="border-b border-border last:border-0">
      <Link href={`/interests/${rule.id}`} className="flex flex-col gap-1 px-4 py-3">
        <span className="flex items-center justify-between gap-2">
          <span className="font-medium">{rule.account}</span>
          <span className="font-medium text-pos tabular-nums">
            {accrued(rule) ? format.money(rule.accruedYtd) : NULL_DISPLAY}
          </span>
        </span>
        <span className="text-sm text-muted">
          {chips.map((chip) => `${chip.rate} ${chip.range}`).join(" · ")}
        </span>
      </Link>
    </li>
  );
}

function Rules(props: Props) {
  const text = useTranslations("interests");
  const { view } = props;
  return (
    <>
      <Card padded={false}>
        <div className="overflow-x-auto max-md:hidden">
          <Table>
            <THead>
              <Th>{text("columns.account")}</Th>
              <Th>{text("columns.tiers")}</Th>
              <Th align="right">{text("columns.tax")}</Th>
              <Th>{text("columns.basis")}</Th>
              <Th align="right">{text("columns.accrued")}</Th>
              <Th>{text("columns.next")}</Th>
              <Th>{text("columns.status")}</Th>
              <Th>
                <span className="sr-only">{text("columns.edit")}</span>
              </Th>
            </THead>
            <TBody>
              {view.rules.map((rule) => (
                <RuleRow key={rule.id} rule={rule} {...props} />
              ))}
            </TBody>
          </Table>
        </div>
        <ul className="flex flex-col md:hidden">
          {view.rules.map((rule) => (
            <RuleItem key={rule.id} rule={rule} format={props.format} />
          ))}
        </ul>
      </Card>
      <p className="text-sm text-faint">{text("footer")}</p>
    </>
  );
}

export function InterestsScreen() {
  const text = useTranslations("interests");
  const read = useApi(interests.listInterestRules, {});
  const format = useFormat();
  const pack = useCountryPack();
  const view = read.data;
  const add = (label: string) =>
    view &&
    format &&
    pack !== undefined && (
      <RuleButton
        draft={newDraft(view.accounts, format.today, pack?.interestTaxPercent ?? "")}
        accounts={view.accounts}
        label={label}
      />
    );

  return (
    <Page title={text("title")} actions={add(text("add"))}>
      <div className="flex flex-col gap-0.5">
        <h1 className="text-title font-semibold tracking-title max-md:sr-only">{text("title")}</h1>
        {view && format && view.rules.length > 0 && (
          <p className="text-muted tabular-nums">
            {text("subtitle", {
              gross: format.money(view.totals.grossYtd),
              net: format.money(view.totals.accruedYtd),
              year: view.totals.year,
            })}
          </p>
        )}
      </div>
      <Loaded state={read}>
        {(loaded) =>
          !format ? null : loaded.rules.length === 0 ? (
            <EmptyState
              title={text("empty.title")}
              description={text("empty.description")}
              actions={add(text("empty.cta"))}
            />
          ) : (
            <Rules view={loaded} format={format} />
          )
        }
      </Loaded>
    </Page>
  );
}
