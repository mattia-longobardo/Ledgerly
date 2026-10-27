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
        schedule={schedule}
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

  it("fills the editor from a preset, previews five passes, and saves the rules", async () => {
    renderControl();
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole("button", { name: T.presets.weekdays8 }));
    const preview = within(dialog).getByRole("list", { name: "Next 5 syncs" });
    expect(within(preview).getAllByRole("listitem")).toHaveLength(5);
    await userEvent.click(within(dialog).getByRole("button", { name: T.save }));
    expect(save).toHaveBeenCalledWith("wallet", {
      rules: [{ kind: "times", times: ["08:00"], days: { kind: "weekdays", weekdays: [1, 2, 3, 4, 5] } }],
    });
  });

  it("refuses two passes closer than the gap and keeps Save off", async () => {
    renderControl({ rules: [{ kind: "times", times: ["06:43"], days: { kind: "every" } }] });
    const dialog = await openDialog();
    const input = within(dialog).getByLabelText("New time for rule 1");
    await userEvent.clear(input);
    await userEvent.type(input, "06:50");
    await userEvent.click(within(dialog).getByRole("button", { name: T.addTime }));
    expect(within(dialog).getByText(/Two syncs at 06:43 and 06:50/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: T.save })).toBeDisabled();
  });

  it("says a cron expression is wrong, and adds and removes rules", async () => {
    renderControl({ rules: [] });
    const dialog = await openDialog();
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
});
