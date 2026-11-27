import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getCompany, requireOffice } from "./lib/access";
import { isValidPoint } from "./lib/geo";
import { locationObj } from "./schema";

// What the office needs from its company to plan routes. The rest of the
// company's settings are in `companies.ts`, for owners and admins.

export const get = query({
  args: {},
  handler: async (ctx) => {
    const { companyId } = await requireOffice(ctx);
    const company = await getCompany(ctx, companyId);
    return { base: company.base ?? null, serviceArea: company.serviceArea ?? null };
  },
});

/** Where routes start (the warehouse). */
export const setBase = mutation({
  args: { base: locationObj },
  handler: async (ctx, { base }) => {
    const { companyId } = await requireOffice(ctx);
    if (!isValidPoint(base)) {
      throw new ConvexError("Esa ubicación no es válida.");
    }
    await ctx.db.patch(companyId, { base });
  },
});
