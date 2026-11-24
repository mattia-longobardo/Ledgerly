"use client";

// "Type a payslip" (R5g, ST-21): beside "Add payslip", for the payslips no profile reads. The new
// payslip is applied at once, so the register shows it where the dialog closes.
import { useTranslations } from "next-intl";
import { useState } from "react";
import { employer } from "@ledgerly/api-contract/payroll";
import { Button } from "@ledgerly/ui/button";
import { useApi } from "@ledgerly/ui/data";
import { usePayrollFormat } from "./format";
import { ManualDialog } from "./manual-dialog";

export function AddManualPayslip({ size = "sm" }: { size?: "sm" | "md" }) {
  const text = useTranslations("payroll.manual");
  const [open, setOpen] = useState(false);
  const catalogue = useApi(employer.listPayslipFields, {}).data;
  const format = usePayrollFormat();
  return (
    <>
      <Button size={size} onClick={() => setOpen(true)} disabled={!catalogue || !format}>
        {text("add")}
      </Button>
      {open && catalogue && format && (
        <ManualDialog
          payslip={null}
          catalogue={catalogue.fields}
          format={format}
          onClose={() => setOpen(false)}
          onSaved={() => setOpen(false)}
        />
      )}
    </>
  );
}
