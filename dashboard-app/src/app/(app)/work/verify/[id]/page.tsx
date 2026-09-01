import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import type { PayslipField, SanityCheck } from "@/lib/contracts";
import { formatMonth } from "@/lib/format";
import { payslipById, pendingVerification } from "@/lib/repo/payslips";
import { requireUserOrRedirect } from "@/lib/auth/require-user";
import { extractionOf } from "../../../_lib/vacation";
import { QueueNav } from "./_components/QueueNav";
import type { QueueEntry } from "./_components/queue";
import { VerifyForm, type VerifyField, type VerifiableField } from "./_components/VerifyForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Verify payslip" };

interface FieldMeta {
  name: VerifiableField;
  label: string;
  hint: string;
  unit: "eur" | "hours";
}

/** Hints name the anchor the rules engine reads, so a wrong pick is obvious. */
const FIELD_META: readonly FieldMeta[] = [
  { name: "net", label: "Net", hint: "NETTO BUSTA", unit: "eur" },
  { name: "gross", label: "Gross", hint: "TOTALE LORDO", unit: "eur" },
  { name: "taxes", label: "Taxes", hint: "TOTALE TRATTENUTE IRPEF + addizionali", unit: "eur" },
  {
    name: "fundContribEmployee",
    label: "Cometa — my share",
    hint: "FONDO C/DIPE",
    unit: "eur",
  },
  {
    name: "fundContribEmployer",
    label: "Cometa — employer",
    hint: "FONDO C/AZIENDA",
    unit: "eur",
  },
  { name: "ferieBalance", label: "Ferie residue", hint: "FERIE RES. — in hours", unit: "hours" },
  { name: "rolBalance", label: "ROL residui", hint: "ROL. RES. — in hours", unit: "hours" },
  {
    name: "ferieTaken",
    label: "Ferie godute",
    hint: "FERIE GOD. — hours used, reported one month in arrears",
    unit: "hours",
  },
  {
    name: "rolTaken",
    label: "ROL goduti",
    hint: "ROL. GOD. — hours used, reported one month in arrears; blank means none",
    unit: "hours",
  },
];

function inputValue(column: string | null, extracted: number | null): string {
  if (column !== null && column !== "") return column.replace(".", ",");
  if (extracted === null) return "";
  return String(extracted).replace(".", ",");
}

export default async function VerifyPayslipPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireUserOrRedirect(`/work/verify/${id}`);

  const payslipId = Number(id);
  if (!Number.isInteger(payslipId)) notFound();

  const [payslip, pendingRows] = await Promise.all([payslipById(payslipId), pendingVerification()]);
  if (payslip === null) notFound();

  // Plain objects: this crosses to the client form, which needs the queue to
  // know where a skip lands.
  const pending: QueueEntry[] = pendingRows.map((row) => ({
    id: row.id,
    month: row.month,
    isThirteenth: row.isThirteenth,
  }));

  const extraction = extractionOf(payslip.rawExtraction);
  const columns: Record<VerifiableField, string | null> = {
    net: payslip.net,
    gross: payslip.gross,
    taxes: payslip.taxes,
    fundContribEmployee: payslip.fundContribEmployee,
    fundContribEmployer: payslip.fundContribEmployer,
    ferieBalance: payslip.ferieBalance,
    ferieTaken: payslip.ferieTaken,
    rolTaken: payslip.rolTaken,
    rolBalance: payslip.rolBalance,
  };

  const fields: VerifyField[] = FIELD_META.map((meta) => {
    const extracted = extraction?.fields[meta.name as PayslipField] ?? null;
    return {
      name: meta.name,
      label: meta.label,
      hint: meta.hint,
      unit: meta.unit,
      initial: inputValue(columns[meta.name], extracted?.value ?? null),
      confidence: extracted?.confidence ?? "low",
      rules: extracted?.rules ?? null,
      llm: extracted?.llm ?? null,
    };
  });

  const checks: SanityCheck[] = extraction?.checks ?? [];

  return (
    <main className="pb-8">
      <PageHeader
        title={`${formatMonth(payslip.month)} payslip`}
        eyebrow={
          <Link href="/work" className="text-fg-muted">
            ← Work
          </Link>
        }
      />

      <p className="px-4 pb-4 text-body-sm text-fg-muted lg:px-8">
        {payslip.status === "verified"
          ? "Already verified. Saving again re-writes the confirmed values and logs the corrections."
          : "Nothing here counts towards a statistic until it is confirmed."}
        {extraction !== null && (
          <span className="num block text-caption">
            Parser {extraction.parserVersion} · text from {extraction.textSource}
            {extraction.llmError !== undefined && " · LLM pass failed, rules only"}
          </span>
        )}
      </p>

      <VerifyForm
        // Belt and braces: moving through the run must never carry the
        // previous payslip's typed values into the next form.
        key={payslip.id}
        payslipId={payslip.id}
        documentId={payslip.paperlessDocId}
        month={payslip.month}
        monthLabel={formatMonth(payslip.month)}
        isThirteenth={payslip.isThirteenth}
        status={payslip.status}
        fields={fields}
        checks={checks}
        pending={pending}
        nav={<QueueNav pending={pending} currentId={payslip.id} />}
      />
    </main>
  );
}
