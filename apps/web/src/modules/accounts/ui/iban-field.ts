/**
 * The sentence under the IBAN field for an answer of the account's Server Actions (ux/n4-account-switch.md
 * §2.4.1), or `null` when the error is not the IBAN's. The other account is named; the IBAN never is.
 */
export function ibanErrorText(
  result: { error: string; other?: string },
  t: (
    key: "errors.ibanInvalid" | "errors.ibanExists" | "errors.ibanArchived",
    values?: { other: string },
  ) => string,
): string | null {
  if (result.error === "iban_invalid") return t("errors.ibanInvalid");
  if (result.error === "iban_exists") return t("errors.ibanExists", { other: result.other ?? "" });
  if (result.error === "iban_archived") return t("errors.ibanArchived", { other: result.other ?? "" });
  return null;
}
