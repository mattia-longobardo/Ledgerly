"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useRef, useState } from "react";
import type { CivilDate } from "@ledgerly/domain/platform/dates";
import type { NumberFormat, UiLocale } from "@ledgerly/domain/platform/format";
import { Button } from "@/ui/button";
import { arrangeFees } from "@ledgerly/domain/funds/client";
import { type FeeForm, newFeeForm } from "@ledgerly/domain/funds/client";
import { FeeDialog } from "./fee-dialog";
import { feeAmountText, type FeeScopeOption, feeScopeText, feeValidityText } from "./fee-text";

interface FeeListProps {
  fees: readonly FeeForm[];
  scopes: readonly FeeScopeOption[];
  todayOn: CivilDate;
  format: NumberFormat;
  locale: UiLocale;
  /** The currency of the fund's amounts. */
  currency: string;
  /** Without them the list is read only (an archived fund). The index is the fee's place in `fees`. */
  onEdit?: (fee: FeeForm, index: number) => void;
  onRemove?: (fee: FeeForm, index: number) => void;
}

const COLUMNS =
  "@3xl:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1.4fr)_minmax(0,1.3fr)_minmax(0,1.3fr)_auto]";

const isLink = (text: string) => /^https?:\/\/\S+$/.test(text.trim());

/**
 * The fees of a fund (screens §7.1), in force first, by basis and by name, the expired ones folded
 * at the end. One markup for every width: the columns of a table where the list has the room for
 * them (48rem of its own, not of the window: in the form that creates a fund it sits in a 560 px
 * column), and three lines per fee below that, with the same two buttons.
 */
function FeeList({ fees, scopes, todayOn, format, locale, currency, onEdit, onRemove }: FeeListProps) {
  const t = useTranslations("funds.fees");
  const { current, expired } = arrangeFees(
    fees.map((fee, index) => ({
      fee,
      index,
      basis: fee.basis,
      label: fee.label,
      validTo: fee.validTo || null,
    })),
    todayOn,
  );
  const actions = onEdit !== undefined || onRemove !== undefined;

  const row = ({ fee, index }: { fee: FeeForm; index: number }) => {
    const validity = feeValidityText(t, fee, locale);
    return (
      <li
        key={fee.id ?? `new-${index}`}
        data-testid="fee-row"
        className={`grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 border-t border-border py-2 @3xl:items-center ${COLUMNS}`}
      >
        <div className="min-w-0 @3xl:order-1">
          <p className="font-medium break-words">{fee.label}</p>
          {fee.note.trim() !== "" &&
            (isLink(fee.note) ? (
              <a
                href={fee.note.trim()}
                rel="noreferrer"
                target="_blank"
                className="focus-ring inline-flex min-h-6 max-w-full items-center rounded-[2px] text-sm break-all text-accent hover:underline"
              >
                {fee.note.trim()}
              </a>
            ) : (
              <p className="text-sm break-words text-muted">{fee.note}</p>
            ))}
        </div>
        <p className="text-right tabular-nums @3xl:order-3 @3xl:text-left">
          {feeAmountText(t, fee, format, currency)}
        </p>
        <p className="col-span-2 flex flex-wrap gap-x-1.5 text-sm text-muted @3xl:contents @3xl:text-base">
          <span className="@3xl:order-2">{t(`basis.${fee.basis}`)}</span>
          <span aria-hidden className="@3xl:hidden">
            ·
          </span>
          <span className="@3xl:order-4">{feeScopeText(t, fee, scopes)}</span>
          {validity !== "" && (
            <span aria-hidden className="@3xl:hidden">
              ·
            </span>
          )}
          <span className="@3xl:order-5">{validity}</span>
        </p>
        {actions && (
          <div className="col-span-2 -ml-2 flex gap-1 @3xl:order-6 @3xl:col-span-1 @3xl:ml-0 @3xl:justify-end">
            {onEdit && (
              <Button
                size="xs"
                variant="ghost"
                aria-label={t("editLabel", { label: fee.label })}
                icon={<Pencil aria-hidden className="size-3.5" />}
                onClick={() => onEdit(fee, index)}
              >
                <span className="@3xl:sr-only">{t("edit")}</span>
              </Button>
            )}
            {onRemove && (
              <Button
                size="xs"
                variant="ghost"
                aria-label={t("removeLabel", { label: fee.label })}
                icon={<Trash2 aria-hidden className="size-3.5" />}
                onClick={() => onRemove(fee, index)}
              >
                <span className="@3xl:sr-only">{t("remove")}</span>
              </Button>
            )}
          </div>
        )}
      </li>
    );
  };

  if (fees.length === 0) return null;
  return (
    <div className="@container min-w-0">
      {current.length > 0 && (
        <>
          <div
            aria-hidden
            className={`hidden gap-x-3 pb-1.5 text-sm font-medium text-muted @3xl:grid ${COLUMNS}`}
          >
            <span>{t("columns.label")}</span>
            <span>{t("columns.basis")}</span>
            <span>{t("columns.amount")}</span>
            <span>{t("columns.scope")}</span>
            <span>{t("columns.validity")}</span>
            {actions && <span className="w-14" />}
          </div>
          <ul className="flex flex-col border-b border-border">{current.map(row)}</ul>
        </>
      )}
      {expired.length > 0 && (
        <details className="mt-2">
          <summary className="focus-ring inline-flex min-h-6 cursor-default items-center rounded-[4px] text-sm font-medium text-muted">
            {t("expired", { count: expired.length })}
          </summary>
          <ul className="mt-1 flex flex-col border-b border-border">{expired.map(row)}</ul>
        </details>
      )}
    </div>
  );
}

interface FeeManagerProps extends Omit<FeeListProps, "onEdit" | "onRemove"> {
  /**
   * Keeps a fee: a new one (`index` is `null`) or the one at `index`. Answers `null` when it is
   * kept, or the message the dialog shows.
   */
  onSave: (fee: FeeForm, index: number | null) => Promise<string | null> | string | null;
  onRemove: (fee: FeeForm, index: number) => void;
  /** An archived fund: the list alone, no button. */
  readOnly?: boolean;
  /** What stands in for the list while it is empty; `add` is the "Add fee" button. */
  empty: (add: ReactNode) => ReactNode;
  /** What follows the "Add fee" button of a list with fees: the estimated cost of Settings. */
  children?: ReactNode;
}

/**
 * The list with its "Add fee" button and its dialog. Where the fees are kept is the caller's: the
 * form that creates a fund holds them in its state, Settings saves each one.
 */
export function FeeManager({ onSave, onRemove, readOnly, empty, children, ...list }: FeeManagerProps) {
  const t = useTranslations("funds.fees");
  const [editing, setEditing] = useState<{ fee: FeeForm; index: number | null } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  // The dialog keeps its last fee while it closes, so its title does not change on the way out.
  const [last, setLast] = useState<{ fee: FeeForm; index: number | null }>({
    fee: newFeeForm(),
    index: null,
  });
  const open = (next: { fee: FeeForm; index: number | null }) => {
    setLast(next);
    setEditing(next);
  };

  /** After a removal the focus goes to the row that took the place, or to "Add fee". */
  function remove(fee: FeeForm, index: number) {
    const rows = () =>
      Array.from(box.current?.querySelectorAll<HTMLElement>('[data-testid="fee-row"]') ?? []);
    const place = rows().findIndex((row) => row.contains(document.activeElement));
    onRemove(fee, index);
    requestAnimationFrame(() => {
      const left = rows();
      const next = left[place] ?? left[left.length - 1];
      (next?.querySelector<HTMLElement>("button") ?? addButton.current)?.focus();
    });
  }

  const add = readOnly ? null : (
    <Button
      ref={addButton}
      size="sm"
      icon={<Plus aria-hidden className="size-3.5" />}
      onClick={() => open({ fee: newFeeForm(), index: null })}
    >
      {t("add")}
    </Button>
  );

  return (
    <div ref={box} className="flex min-w-0 flex-col gap-3">
      {list.fees.length === 0 ? (
        empty(add)
      ) : (
        <>
          <FeeList
            {...list}
            onEdit={readOnly ? undefined : (fee, index) => open({ fee, index })}
            onRemove={readOnly ? undefined : remove}
          />
          {(add || children) && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {add}
              {children}
            </div>
          )}
        </>
      )}
      {!readOnly && (
        <FeeDialog
          open={editing !== null}
          onOpenChange={(next) => {
            if (!next) setEditing(null);
          }}
          fee={last.fee}
          editing={last.index !== null}
          scopes={list.scopes}
          format={list.format}
          onSave={(fee) => onSave(fee, last.index)}
        />
      )}
    </div>
  );
}
