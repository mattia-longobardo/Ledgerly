// Reads other modules ask for: the services and the assets of a person.
import { and, asc, isNull } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { investmentAccounts, investmentAssets } from "../schema";
import { type InvestmentAccount, type InvestmentAsset } from "./types";

// ——— Reads other modules ask for ——————————————————————————————————————————————————————————

/** The services of a person, oldest first, with their account ids. */
export async function listInvestmentAccounts(ctx: Pick<Ctx, "userId">): Promise<InvestmentAccount[]> {
  return getDb()
    .select()
    .from(investmentAccounts)
    .where(userScoped(ctx).owns(investmentAccounts))
    .orderBy(asc(investmentAccounts.createdAt), asc(investmentAccounts.id));
}

/** The asset catalog for the dialogs: active assets by name. */
export async function listAssets(ctx: Pick<Ctx, "userId">): Promise<InvestmentAsset[]> {
  return getDb()
    .select()
    .from(investmentAssets)
    .where(and(userScoped(ctx).owns(investmentAssets), isNull(investmentAssets.archivedAt)))
    .orderBy(asc(investmentAssets.name), asc(investmentAssets.id));
}
