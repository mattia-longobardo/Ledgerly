"use client";

// The price of a position of a manual portfolio (R5d): automatic (the market's daily close) or typed
// by hand, its day, and «to update» when the server says it is older than 5 working days. The switch
// changes the mode of that position; the server refuses `auto` on a market it has no price for.
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { formatDate } from "@ledgerly/format/format";
import { Badge } from "@ledgerly/ui/badge";
import { Switch } from "@ledgerly/ui/switch";
import { setPriceMode } from "../../calls";
import { useOutcome } from "../dialog-kit";
import type { PositionsPage } from "../positions/positions-view";

interface Price {
  mode: "auto" | "manual" | "provider";
  on: string | null;
  stale: boolean;
}

export function PriceMode({
  view,
  holdingId,
  name,
  price,
}: {
  view: PositionsPage;
  holdingId: string | null;
  name: string;
  price: Price;
}) {
  const text = useTranslations("investments.portfolioOps");
  const outcome = useOutcome();
  const [pending, startTransition] = useTransition();
  // The switch moves at once; the answer of the server puts it back on a refusal.
  const [auto, setAuto] = useState(price.mode === "auto");
  const { page } = view;
  const day = price.on === null ? null : formatDate(price.on, "dayMonth", page.say.locale);
  const mode = auto ? text("priceAuto") : text("priceManual");
  const editable = holdingId !== null && !view.past && price.mode !== "provider";
  return (
    <span className="flex flex-wrap items-center gap-1 text-xs text-muted" data-testid="price-mode">
      {editable && (
        <Switch
          checked={auto}
          disabled={pending}
          label={text("priceSwitch", { name })}
          onCheckedChange={(next) => {
            setAuto(next);
            startTransition(async () => {
              const result = await setPriceMode(page.id, holdingId, next ? "auto" : "manual");
              if (!result.ok) setAuto(!next);
              outcome(result, text("priceSaved", { name }));
            });
          }}
        />
      )}
      <span>{day === null ? mode : text("priceOn", { mode, date: day })}</span>
      {price.stale && <Badge tone="warn">{text("stale")}</Badge>}
    </span>
  );
}
