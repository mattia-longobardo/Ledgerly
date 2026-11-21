"use client";

// A position's name in a row: its asset, a link to its activity, and what it is — symbol, class,
// product — with the badges of a manual position and of an inferred cost.
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Badge } from "@ledgerly/ui/badge";
import { Link } from "@ledgerly/ui/router";
import { useProductLabel } from "../labels";
import type { PositionsPage } from "./positions-view";

export function PositionName({
  view,
  assetId,
  product,
  manual,
  extra,
  badge,
}: {
  view: PositionsPage;
  assetId: string | null;
  product: string | null;
  manual: boolean;
  extra?: string | null;
  badge?: ReactNode;
}) {
  const text = useTranslations("investments");
  const productLabel = useProductLabel();
  const asset = view.assetOf(assetId);
  const synced = view.page.overview.service.origin === "synced";
  return (
    <span className="flex min-w-0 flex-col items-start gap-0.5">
      <Link
        href={view.page.href("activity", { asset: assetId ?? undefined })}
        className="focus-ring inline-flex min-h-6 max-w-full items-center rounded-sm font-medium hover:underline"
      >
        <span className="truncate">{asset?.name ?? text("positions.unknownAsset")}</span>
      </Link>
      <span className="text-xs text-muted">
        {[
          asset?.symbol,
          asset ? text(`classes.${asset.class}`) : null,
          product ? productLabel(product) : null,
          extra,
        ]
          .filter(Boolean)
          .join(" · ")}
      </span>
      {(manual && synced) || badge ? (
        <span className="flex flex-wrap gap-1">
          {manual && synced && <Badge tone="neutral">{text("positions.manual")}</Badge>}
          {badge}
        </span>
      ) : null}
    </span>
  );
}
