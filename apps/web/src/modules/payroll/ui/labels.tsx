"use client";

// The words of the catalogue's fields and of a payslip's kind (R5g, E4 and E6): a field a pack adds
// without words of its own shows its key, so a new pack needs no client code.
import { useMessages, useTranslations } from "next-intl";
import { Badge } from "@ledgerly/ui/badge";
import type { KindBadge as Kind } from "./present";

type Text = ReturnType<typeof useTranslations<"payroll">>;

/** A value's name: the field of the wire is a name of the catalogue, whose words are in `payroll.fields`. */
export function useFieldLabel(): (name: string) => string {
  const labels = Object.entries(useMessages().payroll.fields);
  return (name) => labels.find(([key]) => key === name)?.[1] ?? name;
}

/** A register column's short name (`payroll.register.columns`); the field's name when it has none. */
export function useColumnLabel(): (name: string) => string {
  const columns = Object.entries(useMessages().payroll.register.columns);
  const field = useFieldLabel();
  return (name) => columns.find(([key]) => key === name)?.[1] ?? field(name);
}

export function kindLabel(text: Text, badge: NonNullable<Kind>): string {
  return text(`register.kinds.${badge.kind}`, { number: String(badge.extraNumber ?? "") });
}

/** An extra payment, a bonus or a final pay; nothing for an ordinary payslip. */
export function KindBadge({ badge }: { badge: Kind }) {
  const text = useTranslations("payroll");
  return badge && <Badge tone="accent">{kindLabel(text, badge)}</Badge>;
}
