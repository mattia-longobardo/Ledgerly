"use client";

// What the portfolio holds today (docs/design/investments-ux.md §3.1, H6), by service, asset class or
// currency: the slices and their shares of `GET /investments/home`.
import { useTranslations } from "next-intl";
import { PALETTE } from "@ledgerly/design-tokens";
import { CompositionCard } from "@ledgerly/ui/composition-card";
import { LinkTabs } from "@ledgerly/ui/link-controls";
import { centsOf } from "../present";
import type { HomeContext } from "./home-view";

const CLASSES = [
  "stock",
  "etf",
  "fund",
  "bond",
  "crypto",
  "stablecoin",
  "cash",
  "other",
  "unclassified",
] as const;

/**
 * The palette's place of each currency: the order the services first show it in, as the page gave
 * them their colours before the slices were sorted (so a currency keeps its colour).
 */
function currencyColors(context: HomeContext): Map<string, string> {
  const codes: string[] = [];
  for (const service of context.home.services) {
    const shown = centsOf(service.displayValue);
    if (shown !== null && shown > 0n && !codes.includes(service.currency)) codes.push(service.currency);
  }
  return new Map(codes.map((code, index) => [code, PALETTE[index % PALETTE.length]]));
}

function useParts(context: HomeContext) {
  const text = useTranslations("investments");
  const { home, by } = context;
  if (by === "class")
    return home.byClass.map((slice, index) => ({
      key: String(slice.key),
      label: text(`classes.${CLASSES.find((one) => one === slice.key) ?? "unclassified"}`),
      value: slice.value,
      share: slice.share,
      color: PALETTE[index % PALETTE.length],
    }));
  if (by === "ccy") {
    const colors = currencyColors(context);
    return home.byCurrency.map((slice) => ({
      key: String(slice.key),
      label: String(slice.key),
      value: slice.value,
      share: slice.share,
      color: colors.get(String(slice.key)) ?? PALETTE[0],
    }));
  }
  const services = new Map(home.services.map((service) => [service.accountId, service]));
  return home.byService.map((slice) => {
    const service = services.get(String(slice.key));
    return {
      key: String(slice.key),
      label: service?.name ?? "",
      value: slice.value,
      share: slice.share,
      color: service ? context.colorOf(service) : PALETTE[0],
    };
  });
}

export function HomeComposition({ context }: { context: HomeContext }) {
  const text = useTranslations("investments");
  const parts = useParts(context);
  return (
    <CompositionCard
      title={text("home.composition.title")}
      actions={
        <LinkTabs
          label={text("home.composition.by")}
          path="/investments"
          params={{ ...context.section.params, view: context.kept.view }}
          name="by"
          current={context.by}
          options={[
            { value: "service", label: text("home.composition.service") },
            { value: "class", label: text("home.composition.class") },
            { value: "ccy", label: text("home.composition.ccy") },
          ]}
        />
      }
      parts={parts.map((part) => ({
        key: part.key,
        label: part.label,
        color: part.color,
        share: part.share,
        cells: [context.money(part.value), context.percent(part.share, false)],
      }))}
      empty={text("allocation.empty")}
      footer={<p className="text-sm text-muted">{text("home.composition.note")}</p>}
    />
  );
}
