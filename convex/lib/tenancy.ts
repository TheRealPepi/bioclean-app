import type { QueryCtx } from "../_generated/server";

/**
 * The company every row belongs to while the app still has a single one. New
 * rows get it so none is left without a company after
 * `migrations.backfillCompany` has run; undefined before that.
 */
export async function legacyCompanyId(ctx: QueryCtx) {
  return (await ctx.db.query("companies").first())?._id;
}
