// The choice of an account (audit UI-ACC-6): a select of the accounts it is given, by name, with the
// empty choice first when the caller names one. Every form that picks an account draws this.
import type { ReactNode, SelectHTMLAttributes } from "react";
import { Select } from "./input";

export function AccountSelect({
  accounts,
  none,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  accounts: readonly { id: string; name: string }[];
  /** The words of the empty choice (`""`): «any account», «none». */
  none?: string;
  /** Choices of the caller's own, between the empty one and the accounts. */
  children?: ReactNode;
}) {
  return (
    <Select {...props}>
      {none !== undefined && <option value="">{none}</option>}
      {children}
      {accounts.map((account) => (
        <option key={account.id} value={account.id}>
          {account.name}
        </option>
      ))}
    </Select>
  );
}
