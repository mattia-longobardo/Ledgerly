import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../messages/en.json";
import type { WizardForm } from "@domain/modules/funds/forms";
import { FUND_TEMPLATES, type FundTemplate } from "@domain/modules/funds/templates";
import { FundWizard, type FundWizardProps } from "./fund-wizard";

// The step is in the address: the router of the test keeps it and draws the form again.
let search = "";
let redraw = () => {};
const push = vi.fn((href: string) => {
  if (href.startsWith("/funds/new")) {
    search = href.split("?")[1] ?? "";
    redraw();
  }
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: push, refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search),
}));

type Result = { ok: true; id: string } | { ok: false; error: string; detail?: string | null };
const createFund = vi.fn<(form: WizardForm) => Promise<Result>>(async () => ({ ok: true, id: "f1" }));
vi.mock("@/app/(app)/funds/fund-setup", () => ({
  createFundAction: (form: WizardForm) => createFund(form),
}));

const TEMPLATE: FundTemplate = {
  id: "esempio",
  name: "Esempio Previdenza",
  sources: [{ kind: "payroll", accrualPeriod: "quarter", hasDue: true, dueDay: "20" }],
  fees: [{ label: "Quota associativa", basis: "periodic", value: "12", scope: "#0" }],
};

function renderWizard(props: Partial<FundWizardProps> = {}) {
  const tree = () => (
    <NextIntlClientProvider locale="en" messages={messages}>
      <FundWizard
        accounts={[{ id: "a1", name: "Conto corrente" }]}
        taken={{}}
        payrollAvailable
        todayOn="2026-11-14"
        currency="EUR"
        templates={FUND_TEMPLATES}
        format="en-US"
        locale="en"
        {...props}
      />
    </NextIntlClientProvider>
  );
  redraw = () => {};
  const view = render(tree());
  redraw = () => view.rerender(tree());
  // An address the form corrected while it was first drawn.
  redraw();
}

const step = (name: string) => within(screen.getByTestId(`wizard-step-${name}`));
const next = (name: string, label = "Continue") =>
  userEvent.click(step(name).getByRole("button", { name: label }));

async function fillFund() {
  await userEvent.type(screen.getByLabelText("Name"), "Fondo Gamma");
  await userEvent.type(screen.getByLabelText("Provider"), "Esempio Previdenza");
  await userEvent.type(screen.getByLabelText("Member since"), "2026-03-01");
}

beforeEach(() => {
  search = "";
  push.mockClear();
  createFund.mockClear();
  createFund.mockImplementation(async () => ({ ok: true, id: "f1" }));
});

describe("FundWizard", () => {
  it("shows no template field with no template", () => {
    renderWizard({ templates: [] });
    expect(screen.getByTestId("fund-wizard")).toBeInTheDocument();
    expect(screen.queryByLabelText("Template")).not.toBeInTheDocument();
    expect(screen.getByTestId("wizard-step-fund")).toBeVisible();
    expect(screen.getByTestId("wizard-step-sources")).not.toBeVisible();
    // No field asks for a kind of fund, a file or units.
    expect(screen.queryByLabelText(/kind|file|units/i)).not.toBeInTheDocument();
  });

  it("shows the template field with a template, and starts steps 2 and 3 from its rows", async () => {
    renderWizard({ templates: [TEMPLATE] });
    await userEvent.selectOptions(screen.getByLabelText("Template"), "esempio");
    await fillFund();
    await next("fund");
    expect(step("sources").getByText(/From the template “Esempio Previdenza”/)).toBeInTheDocument();
    expect(screen.getByTestId("source-switch-payroll")).toHaveAttribute("aria-checked", "true");
    expect(step("sources").getByLabelText("Due day")).toHaveValue(20);
    await next("sources");
    expect(step("fees").getAllByTestId("fee-row")).toHaveLength(1);
    expect(step("fees").getByText("Quota associativa")).toBeInTheDocument();

    // A change in step 2 makes another template ask before it replaces the choices.
    await userEvent.click(step("fees").getByRole("button", { name: "Back" }));
    await userEvent.click(screen.getByTestId("source-switch-manual"));
    await userEvent.click(step("sources").getByRole("button", { name: "Back" }));
    await userEvent.selectOptions(screen.getByLabelText("Template"), "");
    expect(screen.getByText("The template replaces the choices of steps 2 and 3.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Keep my choices" }));
    expect(screen.getByLabelText("Template")).toHaveValue("esempio");
    await userEvent.selectOptions(screen.getByLabelText("Template"), "");
    await userEvent.click(screen.getByRole("button", { name: "Replace" }));
    expect(screen.getByTestId("source-switch-payroll")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("source-switch-manual")).toHaveAttribute("aria-checked", "false");
  });

  it("stays on step 1 until the name and the date are there", async () => {
    renderWizard();
    await next("fund");
    expect(screen.getByText("Enter a name.")).toBeInTheDocument();
    expect(screen.getByText("Choose the membership date.")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveFocus();
    expect(push).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText("Name"), "Fondo Gamma");
    await userEvent.type(screen.getByLabelText("Member since"), "2026-12-01");
    await next("fund");
    expect(screen.getByText("The date cannot be in the future.")).toBeInTheDocument();
  });

  it("goes back to step 1 from an address that names a later step", async () => {
    search = "step=fees";
    renderWizard();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/funds/new?step=fund"));
    expect(screen.getByTestId("wizard-step-fund")).toBeVisible();
  });

  it("creates a fund from step 1 alone", async () => {
    renderWizard();
    await fillFund();
    await next("fund");
    expect(screen.getByRole("heading", { name: "How you pay in" })).toHaveFocus();
    await next("sources");
    expect(step("fees").getByText("No fees. You can add them later, in the settings.")).toBeInTheDocument();
    await next("fees", "Skip for now");
    expect(
      step("review").getByText("No source: you record contributions and values by hand."),
    ).toBeInTheDocument();
    expect(step("review").getByText("No fees.")).toBeInTheDocument();
    await next("review", "Create fund");
    await waitFor(() => expect(push).toHaveBeenCalledWith("/funds/f1"));
    expect(createFund).toHaveBeenCalledOnce();
    expect(createFund.mock.calls[0][0]).toMatchObject({
      fund: { name: "Fondo Gamma", provider: "Esempio Previdenza", startOn: "2026-03-01" },
      value: "",
      currency: "EUR",
      sources: [],
      fees: [],
    });
  });

  it("sends the sources switched on in order, and a fee's source by its place", async () => {
    renderWizard();
    await fillFund();
    await next("fund");
    await userEvent.click(screen.getByTestId("source-switch-bank_debit"));
    // "Payee contains" starts from the provider of step 1.
    expect(step("sources").getByLabelText("Payee contains")).toHaveValue("Esempio Previdenza");
    await next("sources");
    expect(screen.getByText("Enter the expected amount.")).toBeInTheDocument();
    expect(step("sources").getByLabelText("Expected amount")).toHaveFocus();
    await userEvent.type(step("sources").getByLabelText("Expected amount"), "100");
    await userEvent.click(screen.getByTestId("source-switch-manual"));
    await next("sources");

    await userEvent.click(step("fees").getByRole("button", { name: "Add fee" }));
    const dialog = within(screen.getByRole("dialog", { name: "Add fee" }));
    await userEvent.type(dialog.getByLabelText("Name"), "Per versamento");
    await userEvent.type(dialog.getByLabelText("Value"), "1.50");
    await userEvent.selectOptions(dialog.getByLabelText("Applies to"), "Recurring debit");
    await userEvent.click(dialog.getByRole("button", { name: "Save fee" }));
    await waitFor(() => expect(step("fees").getAllByTestId("fee-row")).toHaveLength(1));
    // Saving a fee is not the step's own "Continue".
    expect(screen.getByTestId("wizard-step-fees")).toBeVisible();
    await next("fees");

    const review = step("review");
    expect(
      review.getByText("Recurring debit: €100.00 every month · payee contains “Esempio Previdenza”"),
    ).toBeInTheDocument();
    expect(review.getByText("One-off payments")).toBeInTheDocument();
    expect(review.getByText("Per versamento · €1.50 per contribution")).toBeInTheDocument();
    await next("review", "Create fund");
    await waitFor(() => expect(createFund).toHaveBeenCalledOnce());
    const sent = createFund.mock.calls[0][0];
    expect(sent.sources.map((source) => source.kind)).toEqual(["bank_debit", "manual"]);
    expect(sent.sources[0]).toMatchObject({ amount: "100", frequencyCount: "1", frequencyUnit: "month" });
    expect(sent.fees).toMatchObject([{ label: "Per versamento", scope: "#0", value: "1.50" }]);
  });

  it("puts a name the server refuses under the name, on step 1", async () => {
    createFund.mockImplementation(async () => ({ ok: false, error: "duplicate_name" }));
    renderWizard();
    await fillFund();
    await next("fund");
    await next("sources");
    await next("fees", "Skip for now");
    await next("review", "Create fund");
    expect(await screen.findByText("A fund with that name already exists.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("wizard-step-fund")).toBeVisible());
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveFocus());
  });

  it("puts a payslip component another fund holds under the components, on step 2", async () => {
    createFund.mockImplementation(async () => ({
      ok: false,
      error: "component_taken",
      detail: "Fondo Alfa",
    }));
    renderWizard();
    await fillFund();
    await next("fund");
    await userEvent.click(screen.getByTestId("source-switch-payroll"));
    await next("sources");
    await next("fees", "Skip for now");
    await next("review", "Create fund");
    expect(
      await screen.findByText(
        "A component is already assigned to “Fondo Alfa”. Remove it here or from the fund “Fondo Alfa”.",
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("wizard-step-sources")).toBeVisible());
  });

  it("says a fund was not created and keeps what was written", async () => {
    createFund.mockImplementation(async () => ({ ok: false, error: "invalid" }));
    renderWizard();
    await fillFund();
    await next("fund");
    await next("sources");
    await next("fees", "Skip for now");
    await next("review", "Create fund");
    expect(await screen.findByRole("alert")).toHaveTextContent("Fund not created. Try again.");
    expect(screen.getByLabelText("Name")).toHaveValue("Fondo Gamma");
  });

  it("has no payslip question without the Payroll module", () => {
    renderWizard({ payrollAvailable: false });
    expect(screen.queryByTestId("source-switch-payroll")).not.toBeInTheDocument();
    expect(
      screen.getByText("Without the Payroll module you also record payslip contributions by hand."),
    ).toBeInTheDocument();
  });
});
