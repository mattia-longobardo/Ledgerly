import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import messages from "../../../../messages/en.json";
import { newSourceForm, type SourceForm } from "@domain/modules/funds/forms";
import { SourceFields, type SourceFieldsProps } from "./source-fields";
import { sourceErrors, sourceProblems, sourceSummary, type SourcesT } from "./source-text";
import { createTranslator } from "next-intl";

function Fields({ start, ...props }: Partial<SourceFieldsProps> & { start: SourceForm }) {
  const [form, setForm] = useState(start);
  return (
    <SourceFields
      form={form}
      onChange={setForm}
      accounts={[{ id: "a1", name: "Conto corrente" }]}
      taken={{}}
      payrollAvailable
      errors={{}}
      todayOn="2026-11-14"
      locale="en"
      idPrefix="s"
      {...props}
    />
  );
}

const renderFields = (start: SourceForm, props: Partial<SourceFieldsProps> = {}) =>
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <Fields start={start} {...props} />
    </NextIntlClientProvider>,
  );

const preview = () => screen.getByTestId("due-preview");

describe("SourceFields, payslip", () => {
  it("says what no due date means, and shows the next due dates once the three fields say them", async () => {
    renderFields({ ...newSourceForm("payroll"), accrualPeriod: "quarter" });
    expect(preview()).toHaveTextContent("With no due date a contribution counts on the day you record it.");
    expect(preview()).toHaveAttribute("aria-live", "polite");
    expect(screen.queryByLabelText("Due day")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("switch", { name: "The transfer has a due date" }));
    expect(screen.getByLabelText("Months after the period ends")).toHaveValue("1");
    expect(screen.getByLabelText("Tolerance (days)")).toHaveValue(15);
    await userEvent.type(screen.getByLabelText("Due day"), "20");
    expect(preview()).toHaveTextContent("Next due dates: 20 Jan · 20 Apr · 20 Jul · 20 Oct");
  });

  it("follows the period and the months after it", async () => {
    renderFields({ ...newSourceForm("payroll"), hasDue: true, dueDay: "31", dueOffsetMonths: "0" });
    // By month, in the same month, held back to the month's length.
    expect(preview()).toHaveTextContent("Next due dates: 30 Nov · 31 Dec · 31 Jan · 28 Feb");
    await userEvent.click(screen.getByRole("button", { name: "Quarter" }));
    expect(preview()).toHaveTextContent("Next due dates: 31 Dec · 31 Mar · 30 Jun · 30 Sep");
  });

  it("disables a component another fund holds, and says which fund", () => {
    renderFields(
      { ...newSourceForm("payroll"), components: [] },
      { taken: { worker: "Fondo Alfa", employer: "Fondo Alfa", tfr: "Fondo Alfa" } },
    );
    for (const name of ["My contribution", "Employer", "TFR"]) {
      expect(screen.getByRole("checkbox", { name })).toBeDisabled();
    }
    expect(screen.getAllByText("Already assigned to “Fondo Alfa”")).toHaveLength(3);
  });

  it("shows the note in the dialog only, and custom due dates read only until a rule replaces them", async () => {
    renderFields(
      { ...newSourceForm("payroll"), customDue: true },
      { showNote: true, customDue: "20/4 · 20/7" },
    );
    expect(screen.getByLabelText("Note")).toBeInTheDocument();
    expect(screen.getByText("Custom due dates: 20/4 · 20/7")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Replace with a rule" }));
    expect(screen.getByRole("switch", { name: "The transfer has a due date" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByLabelText("Due day")).toBeInTheDocument();
  });
});

describe("SourceFields, recurring debit", () => {
  it("asks every N and a unit, with no day of the month for weeks", async () => {
    renderFields(newSourceForm("bank_debit"));
    expect(screen.getByLabelText("Frequency")).toHaveValue(1);
    expect(screen.getByRole("combobox", { name: "Unit of time" })).toHaveValue("month");
    expect(screen.getByRole("option", { name: "month" })).toBeInTheDocument();
    expect(screen.getByLabelText("Debit day")).toBeInTheDocument();
    expect(screen.getByLabelText("Start date")).toBeInTheDocument();
    expect(screen.getByLabelText("End date")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Any account" })).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText("Frequency"));
    await userEvent.type(screen.getByLabelText("Frequency"), "2");
    expect(screen.getByRole("option", { name: "weeks" })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Unit of time" }), "week");
    expect(screen.queryByLabelText("Debit day")).not.toBeInTheDocument();
  });
});

describe("the words and the checks of a source", () => {
  const t = createTranslator({ locale: "en", messages, namespace: "funds.sources" }) as unknown as SourcesT;
  const options = { format: "en-US", locale: "en", currency: "EUR" } as const;

  it("says a payslip source and a debit in one line", () => {
    expect(
      sourceSummary(
        t,
        { ...newSourceForm("payroll"), accrualPeriod: "quarter", hasDue: true, dueDay: "20" },
        options,
      ),
    ).toBe(
      "My contribution, employer, TFR · by quarter · due on day 20 of the next month · tolerance 15 days",
    );
    expect(
      sourceSummary(
        t,
        {
          ...newSourceForm("bank_debit"),
          amount: "100",
          frequencyCount: "3",
          debitDay: "5",
          payeeMatch: "esempio",
        },
        { ...options, accountName: "Conto corrente" },
      ),
    ).toBe("€100.00 every 3 months, on day 5 · from Conto corrente · payee contains “esempio”");
    expect(sourceSummary(t, { ...newSourceForm("bank_debit"), amount: "50", payeeMatch: "x" }, options)).toBe(
      "€50.00 every month · payee contains “x”",
    );
  });

  it("finds what is missing before a source is sent", () => {
    expect(sourceErrors(t, sourceProblems(newSourceForm("bank_debit"), "en-US"))).toEqual({
      amount: "Enter the expected amount.",
      payeeMatch: "Enter a part of the payee's name.",
    });
    expect(
      sourceErrors(t, sourceProblems({ ...newSourceForm("payroll"), components: [], hasDue: true }, "en-US")),
    ).toEqual({ components: "Choose at least one component.", dueDay: "Enter the due day." });
    expect(sourceProblems(newSourceForm("manual"), "en-US")).toEqual({});
  });
});
