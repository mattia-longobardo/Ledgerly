// src/app/interest-credit.ts — a `credit_account` rule's settlements written as movements on its
// manual account (rule M8). Importing this file registers the writer with interests: that module
// must not import transactions, so the one place that knows both is here. The worker imports it.
import "server-only";
import { registerCreditWriter } from "@ledgerly/domain/interests";
import { createManual } from "./(app)/expenses/manual";

// One income movement on the day the settlement settles; the settlement's id is the idempotency key.
registerCreditWriter(async (ctx, credit) => {
  await createManual(
    ctx,
    {
      kind: "income",
      amountCents: credit.netCents,
      on: credit.settleOn,
      accountId: credit.accountId,
      categoryId: credit.categoryId,
      // The rule's match text, when it has one: the bank's own credit would carry it too.
      payee: credit.payeeMatch ?? "",
      note: "",
    },
    credit.entryId,
  );
});
