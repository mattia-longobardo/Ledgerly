import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import messages from "../../../../../../messages/en.json";
import { type AccrualRate, type ForecastInput, forecastOpening } from "@domain/modules/timeoff/accrual";
import type { LeaveDayView, ResidualInput } from "@domain/modules/timeoff/rules";
import type { LeaveTypeView } from "./kinds";
import { type LeavePanelEntry, LeavePanel } from "./leave-panel";

const MINUTES_PER_DAY = 420;
const WINDOW = { from: "2026-01-01", to: "2026-12-31" };
const TYPES: LeaveTypeView[] = [
  {
    id: "vacation",
    name: "Holiday leave",
    color: "primary",
    unit: "half_day",
    hasAllowance: true,
    toCalendar: true,
  },
  { id: "rol", name: "ROL", color: "warn", unit: "half_day", hasAllowance: true, toCalendar: true },
];
/** Two days a month, read from the payslips. */
const RATE: AccrualRate = { minutesPerMonth: 2 * MINUTES_PER_DAY, source: "payslip" };

/** A May payslip that printed five days: the residual of the card and the start of the forecast. */
function renderPanel(entry: LeavePanelEntry, days: LeaveDayView[] = [], rate: AccrualRate | null = RATE) {
  const snapshot = { period: "2026-05-01", remainingHours: 35 };
  const residual: ResidualInput = {
    snapshot,
    allowanceMinutes: null,
    carriedMinutes: 0,
    days,
    countedThrough: "2026-04-01",
    minutesPerDay: MINUTES_PER_DAY,
  };
  const forecast: ForecastInput = {
    rate,
    opening: forecastOpening(snapshot, WINDOW),
    days,
    minutesPerDay: MINUTES_PER_DAY,
  };
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <LeavePanel
        entry={entry}
        data={{
          year: 2026,
          window: WINDOW,
          minutesPerDay: MINUTES_PER_DAY,
          workDays: [1, 2, 3, 4, 5],
          days,
          holidays: new Set(),
          residuals: { vacation: residual },
          forecasts: { vacation: forecast },
          types: TYPES,
        }}
        saving={false}
        error={null}
        onConfirm={vi.fn()}
        onRemove={vi.fn()}
        onClose={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
  return within(screen.getByRole("dialog"));
}

const summary = () => screen.getByTestId("summary");
const line = (label: string) => within(summary()).getByText(label).nextElementSibling as HTMLElement;

describe("the forecast on the day of the absence (release N5.1)", () => {
  it("says what will be left on the first day, beside the residual of the year", () => {
    // Monday 10 to Friday 14 August: June and July have ended, so nine days are there.
    renderPanel({ mode: "range", from: "2026-08-10", to: "2026-08-14" });
    expect(line("Holiday leave balance")).toHaveTextContent("5 d → 0 d");
    expect(line("Holiday leave forecast on 10 Aug 2026")).toHaveTextContent("9 d → 4 d");
    expect(screen.queryByText(/forecast is .* under zero/)).not.toBeInTheDocument();
  });

  it("shows a forecast below zero as a negative number, and still confirms", () => {
    // Two weeks in June against the five days of May: no month has ended in between.
    const panel = renderPanel({ mode: "range", from: "2026-06-08", to: "2026-06-19" });
    const forecast = line("Holiday leave forecast on 8 Jun 2026");
    expect(forecast).toHaveTextContent("5 d → −5 d");
    expect(forecast).toHaveAttribute("data-negative", "true");
    expect(
      panel.getByText(/On 8 Jun 2026 the Holiday leave forecast is 5 d under zero\. You can confirm/),
    ).toBeInTheDocument();
    expect(panel.getByRole("button", { name: "Confirm" })).toBeEnabled();
  });

  it("counts the days already booked before the absence", () => {
    renderPanel({ mode: "range", from: "2026-08-10", to: "2026-08-10" }, [
      { on: "2026-06-15", typeId: "vacation", fraction: 1 },
      { on: "2026-09-01", typeId: "vacation", fraction: 1 },
    ]);
    // The day of June is spent by then; the one of September is not.
    expect(line("Holiday leave forecast on 10 Aug 2026")).toHaveTextContent("8 d → 7 d");
  });

  it("says nothing of a forecast where there is no rate to make one with", () => {
    renderPanel({ mode: "range", from: "2026-08-10", to: "2026-08-14" }, [], null);
    expect(line("Holiday leave balance")).toHaveTextContent("5 d → 0 d");
    expect(within(summary()).queryByText(/forecast on/)).not.toBeInTheDocument();
  });
});
