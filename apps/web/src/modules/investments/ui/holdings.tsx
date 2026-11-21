"use client";

// The commands of a manual position (§3.4): a valuation, a sale, a close, and the reconciliation of a
// position the provider's reading may cover. The dialogs and their fields load when one opens.
import { useTranslations } from "next-intl";
import { lazy, Suspense, useState } from "react";
import { ActionMenu } from "@ledgerly/ui/menu";
import { Opener, type ServiceContext } from "./dialog-kit";

const PositionDialog = lazy(() =>
  import("./holding-dialogs").then((one) => ({ default: one.PositionDialog })),
);

export interface HoldingSummary {
  id: string;
  name: string;
  currency: string;
  origin: "manual" | "provider";
  product: string;
  byValue: boolean;
  quantityText: string | null;
  conflict: boolean;
  readingId: string | null;
  readingOn: string | null;
}

export type HoldingKind = "valuation" | "sell" | "close";

export function HoldingMenu({ holding, context }: { holding: HoldingSummary; context: ServiceContext }) {
  const text = useTranslations("investments");
  const [open, setOpen] = useState<HoldingKind | "reconcile" | null>(null);
  if (holding.origin !== "manual") return null;
  const close = () => setOpen(null);
  const items = [
    ...(context.mode === "assets"
      ? [
          { label: text("actions.value"), onSelect: () => setOpen("valuation") },
          { label: text("actions.sell"), onSelect: () => setOpen("sell") },
          { label: text("actions.close"), onSelect: () => setOpen("close") },
        ]
      : []),
    ...(holding.conflict ? [{ label: text("actions.reconcile"), onSelect: () => setOpen("reconcile") }] : []),
  ];
  if (items.length === 0) return null;
  return (
    <>
      <ActionMenu label={text("actions.holdingMenu", { name: holding.name })} items={items} />
      {open !== null && (
        <Suspense fallback={null}>
          <PositionDialog onClose={close} kind={open} holding={holding} context={context} />
        </Suspense>
      )}
    </>
  );
}

export function ReconcileButton({ holding, context }: { holding: HoldingSummary; context: ServiceContext }) {
  const text = useTranslations("investments");
  return (
    <Opener label={text("actions.reconcile")} size="xs">
      {(close) => (
        <Suspense fallback={null}>
          <PositionDialog onClose={close} kind="reconcile" holding={holding} context={context} />
        </Suspense>
      )}
    </Opener>
  );
}
