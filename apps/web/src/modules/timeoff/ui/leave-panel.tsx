"use client";

import { TriangleAlert } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, type RefObject, useId, useMemo, useState } from "react";
import { daysBetween, isCivilDate } from "@ledgerly/domain/shared/dates";
import { type UiLocale, formatDate } from "@ledgerly/domain/platform/format";
import { Badge } from "@/ui/badge";
import { Button, LinkButton } from "@/ui/button";
import { cn } from "@/ui/cn";
import { Field } from "@/ui/field";
import { Input, Select, Textarea } from "@/ui/input";
import { Modal } from "@/ui/modal";
import { Segmented } from "@/ui/segmented";
import { type ForecastInput, forecastChange } from "@ledgerly/domain/timeoff/client";
import type { LeaveFormInput } from "../actions";
import {
  type LeaveDayKind,
  type LeaveDayView,
  type ResidualInput,
  MAX_RANGE_DAYS,
  otherHalfOf,
  previewLeaveRange,
} from "@ledgerly/domain/timeoff/client";
import { type LeaveTypeOption, fullDate, rangeEnds, shortDay } from "./kinds";

/** A booked row as the panel and the table's buttons need it. */
export interface BookedLeave {
  id: string;
  on: string;
  kind: LeaveDayKind;
  /** Half a day or a whole one, every kind alike (N0). */
  fraction: number;
  note: string | null;
  origin: "manual" | "trek";
  /** What the next Trek pass still owes this row. */
  pending: "none" | "upsert" | "delete";
}

/** Everything the panel works from. The page hands it over; the panel reads nothing itself. */
interface LeavePanelData {
  year: number;
  minutesPerDay: number;
  /** Every booked row of the year shown. */
  days: readonly LeaveDayView[];
  /** The days of the year nobody works, the patron saint included. */
  holidays: ReadonlySet<string>;
  /** What each residual on the page was worked out from, by kind. */
  residuals: Partial<Record<LeaveDayKind, ResidualInput>>;
  /** What each forecast on the page was worked out from, by kind (release N5.1). */
  forecasts?: Partial<Record<LeaveDayKind, ForecastInput>>;
  /** The kinds of leave, as a list: the panel names none of its own (anticipation AN1). */
  types: readonly LeaveTypeOption[];
}

/** What opened the panel: a range of the calendar, the "Add leave" button, or a booked day. */
export type LeavePanelEntry =
  | { mode: "range"; from: string; to: string }
  | { mode: "add"; from: string }
  | { mode: "edit"; date: string; rows: BookedLeave[]; active?: string };

/** How many entries of a list the summary prints before it says "+ N more". */
const LISTED = 6;

/**
 * The one panel leave is stated in (rewrite plan N5): type, duration, note, the days the range
 * leaves out, the rows it replaces, and the residual before and after — worked out here, from what
 * the page handed over, at every change and without a call. Nothing is written before "Confirm".
 *
 * It is a client component with no data of its own to read, so that it can move to the shared
 * interface package as it is. The summary comes from `previewLeaveRange`, which is also what the
 * service runs before it writes: the two say the same thing.
 */
export function LeavePanel({
  entry,
  data,
  saving,
  error,
  finalFocus,
  onRangeChange,
  onConfirm,
  onRemove,
  onRemoveRange,
  onSelectMore,
  onClose,
}: {
  entry: LeavePanelEntry;
  data: LeavePanelData;
  saving: boolean;
  /** What the server said about the last "Confirm", already in words. */
  error: string | null;
  finalFocus?: RefObject<HTMLElement | null>;
  /** The range the fields describe, so the calendar can keep it drawn behind the panel. */
  onRangeChange?: (range: { from: string; to: string } | null) => void;
  onConfirm: (fields: LeaveFormInput) => void;
  onRemove: (row: BookedLeave) => void;
  /** "Remove N days": everything booked in the range of the fields goes (N5 §7.5). */
  onRemoveRange?: (range: { from: string; to: string }) => void;
  /** "Select more days from here": the edited day becomes the first day of a range (N5 §7.5). */
  onSelectMore?: (date: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations("timeoff");
  const locale = useLocale() as UiLocale;
  const id = useId();

  const rows = entry.mode === "edit" ? entry.rows : [];
  const [activeId, setActiveId] = useState(entry.mode === "edit" ? (entry.active ?? rows[0]?.id) : undefined);
  /** The row being edited, until "Add the other half" turns the panel into a new entry. */
  const [editing, setEditing] = useState(entry.mode === "edit");
  const row = editing ? (rows.find((one) => one.id === activeId) ?? rows[0]) : undefined;

  const selectable = data.types.filter((type) => type.selectable);
  const firstDay = entry.mode === "edit" ? entry.date : entry.from;
  const [from, setFrom] = useState(firstDay);
  const [to, setTo] = useState(entry.mode === "range" ? entry.to : firstDay);
  const [kind, setKind] = useState<LeaveDayKind>(row?.kind ?? selectable[0]?.id ?? data.types[0].id);
  /** "split" is half of `kind` and half of `otherKind` on every day, in one step (decision of 17/11/2026). */
  const [fraction, setFraction] = useState<"1" | "0.5" | "split">(row?.fraction === 0.5 ? "0.5" : "1");
  const [note, setNote] = useState(row?.note ?? "");
  /** The second half's kind: the other row of the day when there is one, else what the rules propose. */
  const [otherKind, setOtherKind] = useState<LeaveDayKind>(
    rows.find((one) => one.id !== row?.id)?.kind ?? proposedOther(row?.kind ?? kind),
  );
  const split = fraction === "split";

  /** The kind beside `first`: the rules' proposal when it can be booked, or the first one that can. */
  function proposedOther(first: LeaveDayKind): LeaveDayKind {
    const proposed = otherHalfOf(first);
    if (selectable.some((type) => type.id === proposed)) return proposed;
    return selectable.find((type) => type.id !== first)?.id ?? proposed;
  }

  function changeKind(next: LeaveDayKind) {
    setKind(next);
    // The two halves are of two kinds: picking the second half's kind for the first moves it on.
    if (next === otherKind) setOtherKind(proposedOther(next));
  }

  const typeOf = (one: LeaveDayKind) => data.types.find((type) => type.id === one);
  const nameOf = (one: LeaveDayKind) => typeOf(one)?.name ?? one;
  const days = (minutes: number) =>
    t("units.days", { amount: formatDays(minutes / data.minutesPerDay, locale) });

  /** While the two dates are one day, the last day follows the first: one day stays one day. */
  const [oneDay, setOneDay] = useState(entry.mode !== "range" || entry.from === entry.to);

  function showRange(nextFrom: string, nextTo: string) {
    onRangeChange?.(isCivilDate(nextFrom) && isCivilDate(nextTo) ? { from: nextFrom, to: nextTo } : null);
  }

  function changeFrom(next: string) {
    // "To" never comes before "From": moving the first day past the last one takes it along.
    const end = isCivilDate(next) && (oneDay || (isCivilDate(to) && to < next)) ? next : to;
    setFrom(next);
    setTo(end);
    showRange(next, end);
  }

  function changeTo(next: string) {
    setTo(next);
    setOneDay(next === from);
    showRange(from, next);
  }

  /** The other row of a day that carries two: the fields, "Remove" and "Confirm" follow it. */
  function activate(next: string) {
    const other = rows.find((one) => one.id === next);
    if (other === undefined) return;
    setActiveId(next);
    setKind(other.kind);
    setFraction(other.fraction === 0.5 ? "0.5" : "1");
    setNote(other.note ?? "");
  }

  /** A second half day beside the one that is there, of the kind the rules propose. */
  function addOtherHalf(beside: BookedLeave) {
    const proposed = otherHalfOf(beside.kind);
    setEditing(false);
    setKind(selectable.some((type) => type.id === proposed) ? proposed : (selectable[0]?.id ?? proposed));
    setFraction("0.5");
    setNote("");
  }

  const validDates = isCivilDate(from) && isCivilDate(to) && to >= from;
  const tooLong = validDates && daysBetween(from, to) + 1 > MAX_RANGE_DAYS;
  const preview = useMemo(
    () =>
      validDates && !tooLong
        ? previewLeaveRange(
            {
              from,
              to,
              kind,
              fraction: split ? 0.5 : Number(fraction),
              otherKind: split ? otherKind : null,
              editedKind: row?.kind ?? null,
            },
            { days: data.days, holidays: data.holidays, residuals: data.residuals, year: data.year },
          )
        : null,
    [validDates, tooLong, from, to, kind, fraction, split, otherKind, row?.kind, data],
  );
  const nothing = preview !== null && preview.written.length === 0;

  /** The booked days the range of the fields covers, each with what it carries. */
  const bookedInRange = useMemo(() => {
    if (row !== undefined || !validDates || tooLong) return [];
    const byDate = new Map<string, LeaveDayView[]>();
    for (const day of data.days) {
      if (day.on < from || day.on > to) continue;
      byDate.set(day.on, [...(byDate.get(day.on) ?? []), day]);
    }
    return [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  }, [row, validDates, tooLong, from, to, data.days]);
  /** The step that lists the days "Remove N days" takes away, before it does. */
  const [removing, setRemoving] = useState(false);
  const removable = onRemoveRange !== undefined && bookedInRange.length > 0;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (saving || preview === null || nothing) return;
    onConfirm({
      from,
      to,
      kind,
      fraction: split ? "0.5" : fraction,
      note,
      editedKind: row?.kind ?? null,
      ...(split ? { otherKind } : {}),
    });
  }

  const title = removing
    ? t("panel.removeTitle")
    : row === undefined
      ? t("dialog.addTitle")
      : t("dialog.editTitle");
  const description =
    row !== undefined || (validDates && from === to && entry.mode !== "add")
      ? fullDate(from, locale)
      : entry.mode === "range" && validDates
        ? t("panel.rangeTitle", rangeEnds(from, to, locale))
        : t("dialog.description");

  const listed = (entries: string[]): string =>
    entries.length > LISTED
      ? `${entries.slice(0, LISTED - 1).join(", ")}, ${t("panel.more", { count: entries.length - (LISTED - 1) })}`
      : entries.join(", ");

  /** A day's worth of minutes below zero reads with a real minus sign: "−2 d". */
  const signed = (minutes: number) => (minutes < 0 ? `−${days(-minutes)}` : days(minutes));
  const overdrawn =
    preview?.balances.filter((one) => one.afterMinutes !== null && one.afterMinutes < 0) ?? [];
  /**
   * The forecast on the day the absence starts, before and after it (release N5.1): the year-end
   * residual says what the year adds up to, this says whether the days will be there by then.
   */
  const forecasts = (preview?.balances ?? []).flatMap((one) => {
    const ofKind = (list: readonly LeaveDayView[]) => list.filter((day) => day.kind === one.kind);
    const change = forecastChange(data.forecasts?.[one.kind], { from, to }, data.year, {
      before: ofKind(data.days),
      after: ofKind(preview?.after ?? []),
    });
    return change === null ? [] : [{ kind: one.kind, ...change }];
  });
  // The first day is a date here: a forecast comes only from a range the preview accepted.
  const forecastDate = forecasts.length > 0 ? formatDate(from, "long", locale) : "";
  const otherYear = preview?.written.find((date) => Number(date.slice(0, 4)) !== data.year);

  return (
    <Modal
      open
      onOpenChange={(next) => !next && onClose()}
      title={title}
      description={description}
      width={460}
      finalFocus={finalFocus}
      footer={
        removing ? (
          <>
            <Button className="max-md:h-9" onClick={() => setRemoving(false)}>
              {t("panel.back")}
            </Button>
            <Button
              variant="danger"
              className="max-md:h-9"
              disabled={saving}
              onClick={() => onRemoveRange?.({ from, to })}
            >
              {t("panel.removeRange", { count: bookedInRange.length })}
            </Button>
          </>
        ) : (
          <>
            {row === undefined && removable && (
              <Button
                variant="danger"
                className="mr-auto max-md:h-9"
                onClick={() => setRemoving(true)}
                disabled={saving}
              >
                {t("panel.removeRange", { count: bookedInRange.length })}
              </Button>
            )}
            {row !== undefined && (
              <Button
                variant="danger"
                className="mr-auto max-md:h-9"
                onClick={() => onRemove(row)}
                disabled={saving}
              >
                {t("actions.remove")}
              </Button>
            )}
            <Button className="max-md:h-9" onClick={onClose} disabled={saving}>
              {t("actions.cancel")}
            </Button>
            <Button
              variant="primary"
              className="max-md:h-9"
              type="submit"
              form={`${id}-form`}
              disabled={saving || preview === null || nothing}
            >
              {saving ? t("panel.saving") : t("actions.save")}
            </Button>
          </>
        )
      }
    >
      {removing ? (
        <div className="flex flex-col gap-3" data-testid="remove-range">
          <p className="text-base">{t("panel.removeIntro", { count: bookedInRange.length })}</p>
          <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-card bg-hover p-3 text-base">
            {bookedInRange.map(([on, held]) => (
              <li key={on}>
                {t("panel.removeLine", {
                  day: shortDay(on, locale),
                  kinds: held
                    .map((one) =>
                      one.fraction === 0.5 ? t("panel.half", { kind: nameOf(one.kind) }) : nameOf(one.kind),
                    )
                    .join(", "),
                })}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <form id={`${id}-form`} onSubmit={submit} className="flex flex-col gap-4" data-testid="leave-panel">
          {row !== undefined && (row.origin === "trek" || row.pending !== "none") && (
            <div className="flex flex-wrap gap-1.5">
              {row.origin === "trek" && <Badge tone="neutral">{t("table.fromTrek")}</Badge>}
              {row.pending !== "none" && (
                <Badge tone="warn">{t(`table.pending.${row.pending}` as "table.pending.upsert")}</Badge>
              )}
            </div>
          )}

          {row !== undefined && rows.length > 1 && (
            <Choice label={t("panel.which")}>
              <Segmented
                label={t("panel.which")}
                value={row.id}
                onChange={activate}
                options={rows.map((one) => ({
                  value: one.id,
                  label:
                    one.fraction === 0.5 ? t("panel.half", { kind: nameOf(one.kind) }) : nameOf(one.kind),
                  disabled: saving,
                }))}
              />
            </Choice>
          )}

          {row === undefined && (
            <div className="grid grid-cols-2 gap-3 max-[399px]:grid-cols-1">
              <Field
                label={t("dialog.from")}
                htmlFor={`${id}-from`}
                error={isCivilDate(from) ? undefined : t("errors.invalid")}
              >
                <Input
                  id={`${id}-from`}
                  type="date"
                  value={from}
                  onChange={(event) => changeFrom(event.target.value)}
                  disabled={saving}
                  required
                />
              </Field>
              <Field
                label={t("dialog.to")}
                htmlFor={`${id}-to`}
                error={
                  !isCivilDate(to) || to < from
                    ? t("errors.invalid")
                    : tooLong
                      ? t("errors.range_too_long")
                      : undefined
                }
              >
                <Input
                  id={`${id}-to`}
                  type="date"
                  min={isCivilDate(from) ? from : undefined}
                  value={to}
                  onChange={(event) => changeTo(event.target.value)}
                  disabled={saving}
                  required
                />
              </Field>
            </div>
          )}

          <Field label={t("dialog.kind")} htmlFor={`${id}-kind`}>
            <Select
              id={`${id}-kind`}
              value={kind}
              onChange={(event) => changeKind(event.target.value as LeaveDayKind)}
              disabled={saving}
            >
              {data.types
                // A kind nobody books any more is offered only to the row that already carries it.
                .filter((type) => type.selectable || type.id === row?.kind)
                .map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
            </Select>
          </Field>

          <Choice label={t("dialog.duration")}>
            <Segmented
              label={t("dialog.duration")}
              value={fraction}
              onChange={setFraction}
              options={[
                { value: "1", label: t("dialog.wholeDay"), disabled: saving },
                { value: "0.5", label: t("dialog.halfDay"), disabled: saving },
                { value: "split", label: t("dialog.splitDay"), disabled: saving },
              ]}
            />
            {row !== undefined && rows.length === 1 && row.fraction === 0.5 && (
              <LinkButton className="self-start" onClick={() => addOtherHalf(row)} disabled={saving}>
                {t("panel.otherHalf")}
              </LinkButton>
            )}
          </Choice>

          {split && (
            <Field label={t("dialog.otherKind")} htmlFor={`${id}-other`}>
              <Select
                id={`${id}-other`}
                value={otherKind}
                onChange={(event) => setOtherKind(event.target.value as LeaveDayKind)}
                disabled={saving}
              >
                {data.types
                  .filter((type) => type.id !== kind && (type.selectable || type.id === otherKind))
                  .map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
              </Select>
            </Field>
          )}

          <Field
            label={t("dialog.note")}
            htmlFor={`${id}-note`}
            hint={typeOf(kind)?.local ? t("dialog.localOnly") : t("dialog.noteHint")}
          >
            <Textarea
              id={`${id}-note`}
              rows={2}
              maxLength={200}
              className="min-h-0"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={saving}
            />
          </Field>

          {preview !== null && (
            <div className="flex flex-col gap-2 rounded-card bg-hover p-3">
              <h3 className="text-sm font-semibold">{t("panel.summary")}</h3>
              <dl
                aria-live="polite"
                className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5"
                data-testid="summary"
              >
                <Line label={t("panel.duration")}>
                  {split
                    ? t("panel.durationSplit", {
                        total: days(preview.totalDays * data.minutesPerDay),
                        count: preview.written.length,
                        first: t("panel.half", { kind: nameOf(kind) }),
                        second: t("panel.half", { kind: nameOf(otherKind) }),
                      })
                    : fraction === "0.5"
                      ? t("panel.durationHalf", {
                          total: days(preview.totalDays * data.minutesPerDay),
                          count: preview.written.length,
                        })
                      : t("panel.durationWhole", {
                          total: days(preview.totalDays * data.minutesPerDay),
                          count: preview.written.length,
                        })}
                </Line>

                {preview.excluded.length > 0 && (
                  <Line label={t("panel.excluded")}>
                    {preview.excluded.length}:{" "}
                    {listed(
                      preview.excluded.map((one) =>
                        one.reason === "holiday"
                          ? t("panel.excludedHoliday", { day: shortDay(one.on, locale) })
                          : shortDay(one.on, locale),
                      ),
                    )}
                  </Line>
                )}

                {preview.replaced.length > 0 && (
                  <Line label={t("panel.replaces")}>
                    {preview.replaced.length}:{" "}
                    {listed(
                      preview.replaced.map((one) =>
                        t("panel.replacedDay", {
                          day: shortDay(one.on, locale),
                          kind:
                            one.fraction === 0.5
                              ? t("panel.half", { kind: nameOf(one.kind) })
                              : nameOf(one.kind),
                        }),
                      ),
                    )}
                  </Line>
                )}

                {preview.balances.map((one) => (
                  <Line
                    key={one.kind}
                    label={t("panel.balance", { kind: nameOf(one.kind) })}
                    negative={one.afterMinutes !== null && one.afterMinutes < 0}
                  >
                    {one.beforeMinutes === null || one.afterMinutes === null ? (
                      <>
                        {t("panel.balanceUnknown")}{" "}
                        <Link
                          href={`/timeoff/settings?year=${data.year}` as Route}
                          className="focus-ring rounded-xs font-medium text-accent underline underline-offset-2"
                        >
                          {t("actions.setAllowance")}
                        </Link>
                      </>
                    ) : (
                      t("panel.balanceChange", {
                        before: signed(one.beforeMinutes),
                        after: signed(one.afterMinutes),
                      })
                    )}
                  </Line>
                ))}
                {forecasts.map((one) => (
                  <Line
                    key={`forecast-${one.kind}`}
                    label={t("panel.forecast", { kind: nameOf(one.kind), date: forecastDate })}
                    negative={one.afterMinutes < 0}
                  >
                    {t("panel.balanceChange", {
                      before: signed(one.beforeMinutes),
                      after: signed(one.afterMinutes),
                    })}
                  </Line>
                ))}
              </dl>

              {preview.balances.length === 0 && !nothing && (
                <p className="text-sm text-muted">{t("panel.balanceNone")}</p>
              )}
              {otherYear !== undefined && (
                <p className="text-sm text-muted">
                  {t("panel.otherYear", { count: preview.otherYearDays, year: otherYear.slice(0, 4) })}
                </p>
              )}
              {/* Below zero is an ordinary answer — this is also where leave is planned — so it is
                said plainly and stops nothing. */}
              {overdrawn.map((one) => (
                <p key={one.kind} className="text-sm text-muted">
                  {t("panel.overdrawn", { amount: days(-(one.afterMinutes as number)) })}
                </p>
              ))}
              {forecasts
                .filter((one) => one.afterMinutes < 0)
                .map((one) => (
                  <p key={one.kind} className="text-sm text-muted">
                    {t("panel.forecastBelowZero", {
                      kind: nameOf(one.kind),
                      amount: days(-one.afterMinutes),
                      date: forecastDate,
                    })}
                  </p>
                ))}
              {nothing && (
                <p className="text-sm text-warn">
                  {preview.excluded.length === 1
                    ? t(`errors.${preview.excluded[0].reason}` as "errors.weekend", {
                        date: formatDate(preview.excluded[0].on, "long", locale),
                      })
                    : t("panel.nothingBookable")}
                </p>
              )}
            </div>
          )}

          {row !== undefined && onSelectMore !== undefined && (
            <LinkButton className="self-start" onClick={() => onSelectMore(row.on)} disabled={saving}>
              {t("panel.selectMore")}
            </LinkButton>
          )}

          {error !== null && (
            <p role="alert" className="text-sm text-neg">
              {error}
            </p>
          )}
        </form>
      )}
    </Modal>
  );
}

/** A group of buttons with a label above it, laid out as a `Field` is. */
function Choice({ label, children }: { label: string; children: ReactNode }) {
  return (
    // Taller segments on a phone: 24 px is enough for a mouse and too little for a thumb.
    <div className="flex flex-col gap-1.5 max-md:[&_[role=group]_button]:h-8">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </div>
  );
}

function Line({ label, negative, children }: { label: string; negative?: boolean; children: ReactNode }) {
  return (
    <>
      <dt className="text-sm text-muted">{label}</dt>
      <dd
        data-negative={negative ? "true" : undefined}
        className={cn(
          "flex min-w-0 flex-wrap items-center gap-1 text-base tabular-nums",
          negative && "text-neg",
        )}
      >
        {negative && <TriangleAlert aria-hidden className="size-4 shrink-0" />}
        <span className="min-w-0">{children}</span>
      </dd>
    </>
  );
}

function formatDays(value: number, locale: UiLocale): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
}
