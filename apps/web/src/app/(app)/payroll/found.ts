// The one read a Payroll page asks before it is drawn: a payslip that is not the person's is a 404,
// which only the server can give (`apiRead`). Everything the page shows comes from its screen.
import "server-only";
import { notFound } from "next/navigation";

const UUID = /^[0-9a-f-]{36}$/;

/** Stops at the 404 page unless `read` finds the payslip `id` names. */
export async function foundOr404(id: string, read: (id: string) => Promise<unknown>): Promise<void> {
  if (!UUID.test(id) || !(await read(id))) notFound();
}
