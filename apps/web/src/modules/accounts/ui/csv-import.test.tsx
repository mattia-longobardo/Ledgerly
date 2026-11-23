import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../../../../messages/en.json";
import type { CsvMap, CsvPreview } from "../csv-calls";
import { CsvImportButton } from "./csv-import";

const preview = vi.fn();
const importer = vi.fn();
vi.mock("../csv-calls", () => ({
  previewCsv: (...args: unknown[]) => preview(...args),
  importCsv: (...args: unknown[]) => importer(...args),
}));

const T = messages.accounts.csv;
const MAP: CsvMap = {
  columns: { date: 0, amount: 2, debit: null, credit: null, payee: 1, note: null, category: null },
  delimiter: ";",
  decimalSeparator: ",",
  dateFormat: "DD/MM/YYYY",
  skipRows: 0,
  header: true,
};
const PREVIEW: CsvPreview = {
  delimiter: ";",
  columns: ["Data", "Descrizione", "Importo"],
  rowCount: 2,
  savedMap: null,
  proposedMap: MAP,
  rows: [
    { row: 2, outcome: "ok", reason: null, on: "2026-10-14", amount: "-12.50", payee: "Shop" },
    { row: 3, outcome: "refused", reason: "bad_date", on: null, amount: null, payee: null },
  ],
};
const FILE = new File(["Data;Descrizione;Importo\r\n"], "movements.csv", { type: "text/csv" });

function renderButton() {
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <CsvImportButton
        accountId="acc-1"
        accountName="Cash"
        currency="EUR"
        format={{ locale: "en", timeZone: "Europe/Rome", numberFormat: "en-US" }}
      />
    </NextIntlClientProvider>,
  );
}

async function readFile() {
  await userEvent.click(screen.getByRole("button", { name: T.open }));
  await userEvent.upload(screen.getByLabelText(T.file), FILE);
  await userEvent.click(screen.getByRole("button", { name: T.read }));
}

beforeEach(() => {
  vi.clearAllMocks();
  preview.mockResolvedValue({ ok: true, preview: PREVIEW });
});

describe("CsvImportButton", () => {
  it("says why the server refused the file", async () => {
    preview.mockResolvedValue({ ok: false, error: "account_not_manual" });
    renderButton();
    await readFile();
    expect(await screen.findByRole("alert")).toHaveTextContent(T.errors.account_not_manual);
  });

  it("shows the first rows, imports with the map and saves it, then says what was written", async () => {
    importer.mockResolvedValue({
      ok: true,
      result: { created: 1, duplicates: 2, refused: [{ row: 3, reason: "bad_date" }] },
    });
    renderButton();
    await readFile();
    const table = await screen.findByRole("table", { name: T.previewTitle });
    expect(within(table).getByText(T.reasons.bad_date)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: T.import }));
    expect(importer).toHaveBeenCalledWith("acc-1", FILE, MAP, true);
    expect(await screen.findByText("1 transaction imported")).toBeInTheDocument();
    expect(screen.getByText(`Row 3: ${T.reasons.bad_date}`)).toBeInTheDocument();
  });

  it("asks for the amount before it imports a map without one", async () => {
    preview.mockResolvedValue({ ok: true, preview: { ...PREVIEW, proposedMap: null } });
    renderButton();
    await readFile();
    await userEvent.click(await screen.findByRole("button", { name: T.import }));
    expect(screen.getByRole("alert")).toHaveTextContent(T.errors.map);
    expect(importer).not.toHaveBeenCalled();
  });
});
