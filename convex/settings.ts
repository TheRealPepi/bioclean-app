import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin } from "./lib/access";
import { isValidPoint } from "./lib/geo";
import { legacyCompanyId } from "./lib/tenancy";
import { locationObj } from "./schema";

export const get = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const settings = await ctx.db.query("settings").first();
    return { base: settings?.base ?? null };
  },
});

/** Where routes start (the warehouse). */
export const setBase = mutation({
  args: { base: locationObj },
  handler: async (ctx, { base }) => {
    await requireAdmin(ctx);
    if (!isValidPoint(base)) {
      throw new ConvexError("Esa ubicación no es válida.");
    }
    const settings = await ctx.db.query("settings").first();
    if (settings) await ctx.db.patch(settings._id, { base });
    else await ctx.db.insert("settings", { base });
    // The company row is where the base will live; keep both the same.
    const companyId = await legacyCompanyId(ctx);
    if (companyId) await ctx.db.patch(companyId, { base });
  },
});
