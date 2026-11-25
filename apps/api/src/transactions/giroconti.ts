// Transactions · the giroconti between a person's accounts (decisions 6A–10A of 2026-11-25): the other
// side of a movement, a pair by hand, and the proposals that wait for the person.
import type { Hono } from "hono";
import { TRANSACTIONS } from "@ledgerly/api-contract";
import {
  answerTransferProposal,
  chooseTransferSide,
  listTransferProposals,
  pairByHand,
  type TransferProposal,
} from "@ledgerly/domain/transactions";
import { type ApiEnv, type Guard, serve } from "../serve";
import { refusing } from "./cases";
import { money } from "./dto";

const { giroconti } = TRANSACTIONS;

const leg = ({ amountCents, ...rest }: TransferProposal["out"]) => ({ ...rest, amount: money(amountCents) });

export function serveGiroconti(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, giroconti.listTransferProposals, async ({ ctx }) => ({
    proposals: (await listTransferProposals(ctx)).map((one) => ({
      id: one.id,
      out: leg(one.out),
      in: leg(one.in),
    })),
  }));
  serve(app, guard, giroconti.pairTransfer, async ({ ctx, body }) => {
    await refusing(pairByHand(ctx, body.ids[0], body.ids[1]));
  });
  serve(app, guard, giroconti.answerTransferProposal, async ({ ctx, params, body }) => {
    await refusing(answerTransferProposal(ctx, params.id, body.accept));
  });
  serve(app, guard, giroconti.setTransferSide, async ({ ctx, params, body }) => {
    await refusing(chooseTransferSide(ctx, params.id, body));
  });
}
