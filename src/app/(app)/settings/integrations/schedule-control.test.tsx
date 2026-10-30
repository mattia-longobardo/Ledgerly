import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/en.json";
import {
  DEFAULT_SYNC_SCHEDULE,
  type SyncDays,
  type SyncRule,
  type SyncSchedule,
} from "@/platform/integrations/schedule";
import { ScheduleControl } from "./schedule-control";
import { REPEAT_MINUTES } from "./schedule-form";

const save = vi.fn();

vi.mock("./actions", () => ({
  saveScheduleAction: (...args: unknown[]) => save(...args),
}));

const T = messages.settings.integrations.scheduleControl;

function renderControl(schedule: SyncSchedule = DEFAULT_SYNC_SCHEDULE) {
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <ScheduleControl
        provider="wallet"
        name="Budget Makers Wallet"
        schedule={schedule}
        recommended={DEFAULT_SYNC_SCHEDULE}
        next="27 Oct 2026, 17:00"
        timeZone="Europe/Rome"
      />
    </NextIntlClientProvider>,
  );
}

async function openDialog() {
  await userEvent.click(screen.getByRole("button", { name: T.change }));
  return screen.getByRole("dialog");
}

beforeEach(() => {
  vi.clearAllMocks();
  save.mockResolvedValue({ ok: true });
});

const EVERY: SyncDays = { kind: "every" };
const WORKDAYS: SyncDays = { kind: "weekdays", weekdays: [1, 2, 3, 4, 5] };
const interval = (
  everyMinutes: number,
  from = "00:00",
  until = "23:59",
  days: SyncDays = EVERY,
): SyncRule => ({
  kind: "interval",
  everyMinutes,
  from,
  until,
  days,
});

/** Every row of the table in docs/scheduler.md, with the mode the dialog must open it in. */
const UNCHANGED: [string, "repeat" | "times" | "manual" | "custom", SyncSchedule][] = [
  ["no rule", "manual", { rules: [] }],
  ...REPEAT_MINUTES.map((minutes): [string, "repeat", SyncSchedule] => [
    `every ${minutes} minutes`,
    "repeat",
    { rules: [interval(minutes)] },
  ]),
  ["a window on workdays", "repeat", { rules: [interval(30, "08:00", "19:00", WORKDAYS)] }],
  [
    "a window on picked days",
    "repeat",
    { rules: [interval(240, "06:15", "20:45", { kind: "weekdays", weekdays: [2, 6, 7] })] },
  ],
  ["two times", "times", { rules: [{ kind: "times", times: ["07:30", "22:30"], days: EVERY }] }],
  [
    "a time on month days",
    "times",
    { rules: [{ kind: "times", times: ["06:43"], days: { kind: "monthDays", monthDays: [-1, 1, 15] } }] },
  ],
  ["an interval the Select does not offer", "custom", { rules: [interval(45)] }],
  ["a whole number of hours it does not offer", "custom", { rules: [interval(180, "01:00", "23:00")] }],
  ["a cron rule", "custom", { rules: [{ kind: "cron", expression: "43 6 * * 1-5" }] }],
  [
    "two rules",
    "custom",
    {
      rules: [
        { kind: "times", times: ["06:43"], days: WORKDAYS },
        { kind: "cron", expression: "30 18 * * 6,0" },
      ],
    },
  ],
];

describe("ScheduleControl", () => {
  it.each(UNCHANGED)(
    "opens %s in its mode, and saving untouched sends the same JSON",
    async (_, mode, rules) => {
      renderControl(rules);
      const dialog = await openDialog();
      expect(within(dialog).getByRole("radio", { name: new RegExp(`^${T.modes[mode]}`) })).toBeChecked();
      await userEvent.click(within(dialog).getByRole("button", { name: T.save }));
      expect(save).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(save.mock.calls[0][1])).toBe(JSON.stringify(rules));
    },
  );

  it("sums the schedule up on the card", () => {
    renderControl({
      rules: [
        { kind: "times", times: ["06:43"], days: { kind: "weekdays", weekdays: [1, 2, 3, 4, 5] } },
        { kind: "cron", expression: "0 12 * * *" },
      ],
    });
    expect(screen.getByText("At 06:43 · Mon–Fri +1")).toBeInTheDocument();
  });

  it("opens a repeating rule as Repeat, previews the passes in 24 hours, and saves the same rules", async () => {
    const schedule: SyncSchedule = {
      rules: [
        {
          kind: "interval",
          everyMinutes: 30,
          from: "08:00",
          until: "19:00",
          days: { kind: "weekdays", weekdays: [1, 2, 3, 4, 5] },
        },
      ],
    };
    renderControl(schedule);
    const dialog = await openDialog();
    expect(within(dialog).getByRole("radio", { name: T.modes.repeat })).toBeChecked();
    expect(within(dialog).getByLabelText(T.onlyBetween)).toBeChecked();
    const preview = within(dialog).getByRole("list", { name: T.preview.title });
    const items = within(preview).getAllByRole("listitem");
    expect(items).toHaveLength(5);
    expect(items[0].textContent).not.toMatch(/AM|PM/);
    await userEvent.click(within(dialog).getByRole("button", { name: T.save }));
    expect(save).toHaveBeenCalledWith("wallet", schedule);
  });

  it("sets an exact time under At set times, on the days chosen, and saves it", async () => {
    renderControl();
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole("radio", { name: new RegExp(T.modes.times) }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove 07:30" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove 22:30" }));
    const input = within(dialog).getByLabelText(T.newTimeSimple);
    await userEvent.clear(input);
    await userEvent.type(input, "643");
    await userEvent.click(within(dialog).getByRole("button", { name: T.addTime }));
    await userEvent.click(within(dialog).getByRole("button", { name: T.days.choices.workdays }));
    await userEvent.click(within(dialog).getByRole("button", { name: T.save }));
    expect(save).toHaveBeenCalledWith("wallet", {
      rules: [{ kind: "times", times: ["06:43"], days: { kind: "weekdays", weekdays: [1, 2, 3, 4, 5] } }],
    });
  });

  it("refuses two passes closer than the gap and keeps Save off", async () => {
    renderControl({ rules: [{ kind: "times", times: ["06:43"], days: { kind: "every" } }] });
    const dialog = await openDialog();
    const input = within(dialog).getByLabelText(T.newTimeSimple);
    await userEvent.clear(input);
    await userEvent.type(input, "06:50");
    await userEvent.click(within(dialog).getByRole("button", { name: T.addTime }));
    expect(within(dialog).getByText(/Two syncs at 06:43 and 06:50/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: T.save })).toBeDisabled();
  });

  it("refuses a time that is not one", async () => {
    renderControl();
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole("radio", { name: new RegExp(T.modes.times) }));
    const input = within(dialog).getByLabelText(T.newTimeSimple);
    await userEvent.clear(input);
    await userEvent.type(input, "25:00");
    await userEvent.click(within(dialog).getByRole("button", { name: T.addTime }));
    expect(within(dialog).getByText(T.errors.time)).toBeInTheDocument();
  });

  it("opens a cron rule under Custom rules untouched, and Cancel leaves it there", async () => {
    const schedule: SyncSchedule = { rules: [{ kind: "cron", expression: "43 6 * * 1-5" }] };
    renderControl(schedule);
    const dialog = await openDialog();
    expect(within(dialog).getByRole("radio", { name: new RegExp(T.modes.custom) })).toBeChecked();
    expect(within(dialog).getByLabelText(T.cron)).toHaveValue("43 6 * * 1-5");
    await userEvent.click(within(dialog).getByRole("button", { name: T.save }));
    expect(save).toHaveBeenCalledWith("wallet", schedule);
  });

  it("says a cron expression is wrong, and adds and removes rules", async () => {
    renderControl({ rules: [] });
    const dialog = await openDialog();
    expect(within(dialog).getByRole("radio", { name: new RegExp(T.modes.manual) })).toBeChecked();
    await userEvent.click(within(dialog).getByRole("radio", { name: new RegExp(T.modes.custom) }));
    expect(within(dialog).getByText(T.manualHint)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: T.addRule }));
    await userEvent.selectOptions(within(dialog).getByLabelText("Kind of rule 1"), "cron");
    const cron = within(dialog).getByLabelText(T.cron);
    await userEvent.clear(cron);
    await userEvent.type(cron, "61 * * * *");
    expect(within(dialog).getByText(T.errors.cron)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: T.save })).toBeDisabled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove rule 1" }));
    expect(within(dialog).getByText(T.manualHint)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: T.save })).toBeEnabled();
  });

  it("fills in what is recommended for this connection", async () => {
    renderControl({ rules: [] });
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole("button", { name: /Use recommended/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: T.save }));
    expect(save).toHaveBeenCalledWith("wallet", DEFAULT_SYNC_SCHEDULE);
  });
});
