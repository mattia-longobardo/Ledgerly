"use client";

// The columns of a CSV file and its first rows, as the server read them (rewrite plan R5c): the
// second step of «Import CSV». A column is its place in the row, from 0.
import { useTranslations } from "next-intl";
import { useId } from "react";
import { parseCents } from "@ledgerly/format/cents";
import { formatDate, formatMoney } from "@ledgerly/format/format";
import { Field } from "@ledgerly/ui/field";
import { Checkbox, Input, Select } from "@ledgerly/ui/input";
import { Table, TBody, Td, Th, THead, Tr } from "@ledgerly/ui/table";
import type { CsvMap, CsvPreview } from "../csv-calls";
import type { CardFormat } from "./net-worth-card";

const REASONS = [
  "bad_date",
  "bad_amount",
  "no_amount",
  "zero_amount",
  "future_date",
  "missing_column",
] as const;
const DATE_FORMATS = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "DD.MM.YYYY", "DD-MM-YYYY"];
const ROLES = ["date", "payee", "note", "category"] as const;

type Columns = CsvMap["columns"];
export type CsvText = ReturnType<typeof useTranslations<"accounts.csv">>;

export function reasonText(text: CsvText, code: string | null): string {
  const known = REASONS.find((one) => one === code);
  return known === undefined ? text("reasons.other", { code: code ?? "" }) : text(`reasons.${known}`);
}

/** A select of the file's columns; `optional` adds «Not in the file». */
function ColumnSelect({
  label,
  names,
  value,
  optional,
  onChange,
}: {
  label: string;
  names: readonly string[];
  value: number | null;
  optional: boolean;
  onChange: (value: number | null) => void;
}) {
  const text = useTranslations("accounts.csv");
  const id = useId();
  return (
    <Field label={label} htmlFor={id}>
      <Select
        id={id}
        value={value === null ? "" : String(value)}
        onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
      >
        {optional && <option value="">{text("none")}</option>}
        {names.map((name, index) => (
          <option key={index} value={index}>
            {name.trim() === "" ? text("column", { number: index + 1 }) : name}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function MapFields({
  columns: names,
  map,
  onChange,
}: {
  columns: readonly string[];
  map: CsvMap;
  onChange: (map: CsvMap) => void;
}) {
  const text = useTranslations("accounts.csv");
  const id = useId();
  const { columns } = map;
  const signed = columns.amount !== null;
  const setColumns = (change: Partial<Columns>) => onChange({ ...map, columns: { ...columns, ...change } });
  const formats = DATE_FORMATS.includes(map.dateFormat) ? DATE_FORMATS : [map.dateFormat, ...DATE_FORMATS];
  const column = (role: keyof Columns, optional: boolean) => (
    <ColumnSelect
      key={role}
      label={text(`roles.${role}`)}
      names={names}
      value={columns[role]}
      optional={optional}
      onChange={(value) => setColumns({ [role]: value })}
    />
  );
  return (
    <fieldset className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
      <legend className="mb-1.5 text-sm font-medium">{text("mapTitle")}</legend>
      {ROLES.map((role) => column(role, role !== "date"))}
      <Field label={text("amountMode")} htmlFor={`${id}-mode`}>
        <Select
          id={`${id}-mode`}
          value={signed ? "signed" : "split"}
          onChange={(event) =>
            setColumns(
              event.target.value === "signed"
                ? { amount: columns.debit ?? columns.credit ?? 0, debit: null, credit: null }
                : { amount: null, debit: columns.amount, credit: null },
            )
          }
        >
          <option value="signed">{text("amountModes.signed")}</option>
          <option value="split">{text("amountModes.split")}</option>
        </Select>
      </Field>
      {signed ? column("amount", false) : [column("debit", true), column("credit", true)]}
      <FormatFields map={map} formats={formats} onChange={onChange} />
    </fieldset>
  );
}

function FormatFields({
  map,
  formats,
  onChange,
}: {
  map: CsvMap;
  formats: readonly string[];
  onChange: (map: CsvMap) => void;
}) {
  const text = useTranslations("accounts.csv");
  const id = useId();
  return (
    <>
      <Field label={text("dateFormat")} htmlFor={`${id}-date`}>
        <Select
          id={`${id}-date`}
          value={map.dateFormat}
          onChange={(event) => onChange({ ...map, dateFormat: event.target.value })}
        >
          {formats.map((format) => (
            <option key={format} value={format}>
              {format}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={text("decimal")} htmlFor={`${id}-decimal`}>
        <Select
          id={`${id}-decimal`}
          value={map.decimalSeparator === "," ? "comma" : "point"}
          onChange={(event) =>
            onChange({ ...map, decimalSeparator: event.target.value === "comma" ? "," : "." })
          }
        >
          <option value="comma">{text("decimals.comma")}</option>
          <option value="point">{text("decimals.point")}</option>
        </Select>
      </Field>
      <SkipRowsField map={map} onChange={onChange} />
      <div className="flex items-end">
        <Checkbox
          checked={map.header}
          onChange={(event) => onChange({ ...map, header: event.target.checked })}
          label={text("header")}
        />
      </div>
    </>
  );
}

/** The first rows as the server read them, with the map it had when the file was read. */
export function PreviewTable({
  preview,
  currency,
  format,
}: {
  preview: CsvPreview;
  currency: string;
  format: CardFormat;
}) {
  const text = useTranslations("accounts.csv");
  const titleId = useId();
  const { locale, numberFormat } = format;
  return (
    <section className="flex flex-col gap-2" aria-labelledby={titleId}>
      <h3 id={titleId} className="text-sm font-medium">
        {text("previewTitle")}
      </h3>
      <p className="text-xs text-faint">{text("previewNote")}</p>
      <div className="overflow-x-auto">
        <Table aria-labelledby={titleId}>
          <THead>
            <Tr>
              <Th>{text("table.row")}</Th>
              <Th>{text("table.date")}</Th>
              <Th align="right">{text("table.amount")}</Th>
              <Th>{text("table.payee")}</Th>
              <Th>{text("table.outcome")}</Th>
            </Tr>
          </THead>
          <TBody>
            {preview.rows.map((row) => (
              <Tr key={row.row}>
                <Td className="tabular-nums">{row.row}</Td>
                <Td>{row.on === null ? "" : formatDate(row.on, "long", locale)}</Td>
                <Td align="right">
                  {row.amount === null
                    ? ""
                    : formatMoney(parseCents(row.amount), numberFormat, {
                        signed: true,
                        currency,
                      })}
                </Td>
                <Td>{row.payee ?? ""}</Td>
                <Td className={row.outcome === "ok" ? "text-muted" : "text-neg"}>
                  {row.outcome === "ok" ? text("ok") : reasonText(text, row.reason)}
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </div>
    </section>
  );
}

function SkipRowsField({ map, onChange }: { map: CsvMap; onChange: (map: CsvMap) => void }) {
  const text = useTranslations("accounts.csv");
  const id = useId();
  return (
    <Field label={text("skipRows")} htmlFor={id}>
      <Input
        id={id}
        type="number"
        min={0}
        max={100}
        numeric
        value={map.skipRows}
        onChange={(event) =>
          onChange({ ...map, skipRows: Math.max(0, Math.trunc(Number(event.target.value) || 0)) })
        }
      />
    </Field>
  );
}
