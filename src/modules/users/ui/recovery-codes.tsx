"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/ui/button";
import { notify } from "@/ui/toast";
import { recoveryCodesFile } from "../two-factor";

/**
 * The ten recovery codes, the one moment they are shown (docs/auth-design.md D2): each works once,
 * and only their encrypted form stays in the database.
 */
export function RecoveryCodes({ codes, account }: { codes: readonly string[]; account: string }) {
  const t = useTranslations("auth.twoFactor");
  const [copied, setCopied] = useState(false);

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied(true);
    } catch {
      notify(t("copyFailed"), "error");
    }
  }

  function onDownload() {
    const url = URL.createObjectURL(new Blob([recoveryCodesFile(codes, account)], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "ledgerly-recovery-codes.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-2">
      <ul
        aria-label={t("recoveryCodes")}
        data-testid="recovery-codes"
        className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-ctl border border-border bg-hover px-3 py-2 font-mono text-sm"
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onDownload}>
          {t("download")}
        </Button>
        <Button size="sm" onClick={onCopy}>
          {copied ? t("copied") : t("copy")}
        </Button>
      </div>
    </div>
  );
}
