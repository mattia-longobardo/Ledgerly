import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../messages/en.json";
import { DEFAULT_SYNC_SCHEDULE, type SyncSchedule } from "@/platform/integrations/schedule";
import { ScheduleControl } from "./schedule-control";

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

describe("ScheduleControl", () => {
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
