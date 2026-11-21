// The calls of Payroll › Settings to `/api/v1` (rewrite plan R3): the code map. Each keeps the name
// and the answer of the Server Action it replaces.
import { codes } from "@ledgerly/api-contract/payroll";
import { call } from "@ledgerly/api-client";
import { invalidate } from "@ledgerly/ui/data";
import { writing, type WriteResult } from "@/platform/writes";

const codesChanged = () => invalidate(codes.listPayrollCodes);

/** What a code means; an empty note is no note. A code or a role the route refuses is `invalid_value`. */
export async function setCodeRoleAction(code: string, role: string, note: string): Promise<WriteResult> {
  const params = codes.setPayrollCode.params.safeParse({ code: code.trim() });
  const body = codes.setPayrollCode.body.safeParse({ role, note: note.trim() || null });
  if (!params.success || !body.success) return { ok: false, error: "invalid_value" };
  return writing(() => call(codes.setPayrollCode, { params: params.data, body: body.data }), codesChanged);
}

export function resetCodeAction(code: string): Promise<WriteResult> {
  return writing(() => call(codes.resetPayrollCode, { params: { code } }), codesChanged);
}
