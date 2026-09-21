"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useId, useState, useTransition } from "react";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Select } from "@/ui/input";
import { Modal } from "@/ui/modal";
import { notify } from "@/ui/toast";
import type { HolidayCountry, HolidaySubdivision } from "@/platform/holidays/sources";
import {
  type HolidayActionResult,
  addHolidayCalendarAction,
  holidayCountriesAction,
  holidaySubdivisionsAction,
  refreshHolidayCalendarAction,
  removeHolidayCalendarAction,
} from "./holiday-actions";

/** One subscribed calendar, as the card shows it. */
export interface CalendarRow {
  id: string;
  label: string;
  source: string;
  country: string;
  subdivision: string | null;
  /** Already formatted by the page, which owns the locale and the zone. */
  lastSynced: string | null;
  lastError: string | null;
  /** How many days this calendar holds for the year on screen. */
  days: number;
}

/**
 * Settings › Profile, the holiday calendars (M3).
 *
 * More than one on purpose: somebody who works across two countries, or who keeps the town they
 * are from as well as the one they live in. The days are fetched from the source and refreshed
 * daily — they are somebody else's facts, and a bank holiday that moves has to be able to move
 * here too.
 */
export function HolidayCalendars({ calendars, year }: { calendars: CalendarRow[]; year: number }) {
  const t = useTranslations("settings.holidays");
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function report(result: HolidayActionResult, success: string): void {
    if (result.ok) {
      setError(null);
      notify(success);
      router.refresh();
      return;
    }
    setError(t(`errors.${result.error}` as "errors.failed"));
  }

  return (
    <div className="flex flex-col gap-3">
      {calendars.length === 0 ? (
        <p className="text-muted">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {calendars.map((calendar) => (
            <li
              key={calendar.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-card border border-border p-3"
            >
              <div className="min-w-0 flex-1 basis-48">
                <div className="truncate font-medium">{calendar.label}</div>
                <div className="text-sm text-muted">
                  {t("meta", {
                    days: calendar.days,
                    year,
                    source: t(`sources.${calendar.source}` as "sources.nager"),
                  })}
                </div>
                {calendar.lastError !== null && (
                  <p className="text-sm text-neg">{t("lastFailed", { error: calendar.lastError })}</p>
                )}
              </div>
              <div className="text-sm text-muted">
                {calendar.lastSynced === null ? t("never") : t("updated", { when: calendar.lastSynced })}
              </div>
              <div className="ml-auto flex gap-1.5">
                <Button
                  size="xs"
                  disabled={pending}
                  onClick={() =>
                    start(async () =>
                      report(await refreshHolidayCalendarAction(calendar.id), t("toasts.refreshed")),
                    )
                  }
                >
                  {t("actions.refresh")}
                </Button>
                <Button
                  size="xs"
                  variant="danger"
                  disabled={pending}
                  onClick={() => {
                    if (!window.confirm(t("actions.confirmRemove", { label: calendar.label }))) return;
                    start(async () =>
                      report(await removeHolidayCalendarAction(calendar.id), t("toasts.removed")),
                    );
                  }}
                >
                  {t("actions.remove")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {error !== null && (
        <p role="alert" className="text-sm text-neg">
          {error}
        </p>
      )}

      <div>
        <Button
          onClick={() => {
            setError(null);
            setAdding(true);
          }}
        >
          {t("actions.add")}
        </Button>
      </div>

      {adding && <AddCalendar onOpenChange={setAdding} onDone={report} />}
    </div>
  );
}

/** The picker: a country from either service, then a place inside it when there is one. */
function AddCalendar({
  onOpenChange,
  onDone,
}: {
  onOpenChange: (open: boolean) => void;
  onDone: (result: HolidayActionResult, success: string) => void;
}) {
  const t = useTranslations("settings.holidays");
  const id = useId();
  const [pending, start] = useTransition();
  const [countries, setCountries] = useState<HolidayCountry[] | null>(null);
  const [places, setPlaces] = useState<HolidaySubdivision[]>([]);
  const [country, setCountry] = useState("");
  const [place, setPlace] = useState("");
  const [error, setError] = useState<string | null>(null);

  // The country list is somebody else's, so it is fetched when the dialog opens and not before.
  useEffect(() => {
    let alive = true;
    void holidayCountriesAction().then((result) => {
      if (!alive) return;
      if (result.ok) setCountries(result.countries);
      else setError(t(`errors.${result.error}` as "errors.failed"));
    });
    return () => {
      alive = false;
    };
  }, [t]);

  const chosen = countries?.find((one) => one.code === country) ?? null;

  // The places of the country in hand. Clearing the old ones belongs to the change handler below,
  // not here: resetting state synchronously inside an effect makes React render twice for nothing.
  useEffect(() => {
    if (chosen === null || !chosen.hasSubdivisions) return;
    let alive = true;
    void holidaySubdivisionsAction(chosen.source, chosen.code).then((result) => {
      if (!alive) return;
      if (result.ok) setPlaces(result.places);
    });
    return () => {
      alive = false;
    };
  }, [chosen]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (chosen === null) return;
    const picked = places.find((one) => one.code === place) ?? null;
    // What it is called on screen: the country, and the place inside it when one was chosen.
    const label = picked === null ? chosen.name : `${chosen.name} · ${picked.path}`;
    start(async () => {
      const result = await addHolidayCalendarAction({
        source: chosen.source,
        country: chosen.code,
        subdivision: picked?.code ?? null,
        label,
      });
      if (!result.ok) {
        setError(t(`errors.${result.error}` as "errors.failed"));
        return;
      }
      onDone(result, t("toasts.added"));
      onOpenChange(false);
    });
  }

  return (
    <Modal
      open
      onOpenChange={onOpenChange}
      title={t("add.title")}
      description={t("add.description")}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)} disabled={pending}>
            {t("add.cancel")}
          </Button>
          <Button variant="primary" form={`${id}-form`} type="submit" disabled={pending || chosen === null}>
            {t("add.submit")}
          </Button>
        </>
      }
    >
      <form id={`${id}-form`} onSubmit={submit} className="flex flex-col gap-4">
        <Field label={t("add.country")} htmlFor={`${id}-country`} hint={t("add.countryHint")}>
          <Select
            id={`${id}-country`}
            value={country}
            disabled={countries === null}
            onChange={(event) => {
              // A new country means new places; the old ones belonged to another country.
              setCountry(event.target.value);
              setPlace("");
              setPlaces([]);
            }}
          >
            <option value="">{countries === null ? t("add.loading") : t("add.choose")}</option>
            {(countries ?? []).map((one) => (
              <option key={one.code} value={one.code}>
                {one.name}
              </option>
            ))}
          </Select>
        </Field>

        {chosen !== null &&
          (chosen.hasSubdivisions ? (
            <Field label={t("add.place")} htmlFor={`${id}-place`} hint={t("add.placeHint")}>
              <Select id={`${id}-place`} value={place} onChange={(event) => setPlace(event.target.value)}>
                <option value="">{t("add.wholeCountry")}</option>
                {places.map((one) => (
                  <option key={one.code} value={one.code}>
                    {one.path}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <p className="text-sm text-muted">{t("add.countryOnly")}</p>
          ))}

        {error !== null && (
          <p role="alert" className="text-sm text-neg">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
