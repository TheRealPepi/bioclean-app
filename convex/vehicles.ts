import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { getOwned, requireOffice, requireUser } from "./lib/access";
import { cleanName, normalizeKey } from "./lib/text";

const vehicleNamed = (ctx: QueryCtx, companyId: Id<"companies">, key: string) =>
  ctx.db
    .query("vehicles")
    .withIndex("by_company_normalized", (q) =>
      q.eq("companyId", companyId).eq("normalizedName", key),
    )
    .first();

/** Every vehicle of the company, archived included (drivers only show the active ones). */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const { companyId } = await requireUser(ctx);
    const vehicles = await ctx.db
      .query("vehicles")
      .withIndex("by_company_normalized", (q) => q.eq("companyId", companyId))
      .collect();
    return vehicles
      .map((veh) => ({ _id: veh._id, name: veh.name, active: veh.active }))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  },
});

export const create = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const { companyId } = await requireOffice(ctx);
    const clean = cleanName(name);
    const key = normalizeKey(clean);
    if (!key) throw new ConvexError("Escribe el nombre del vehículo.");
    const existing = await vehicleNamed(ctx, companyId, key);
    if (existing?.active) throw new ConvexError(`Ya existe el vehículo "${existing.name}".`);
    if (existing) {
      // Same name as a removed one: bring it back.
      await ctx.db.patch(existing._id, { active: true });
      return existing._id;
    }
    return await ctx.db.insert("vehicles", {
      companyId,
      name: clean,
      normalizedName: key,
      active: true,
    });
  },
});

export const rename = mutation({
  args: { vehicleId: v.id("vehicles"), name: v.string() },
  handler: async (ctx, { vehicleId, name }) => {
    const { companyId } = await requireOffice(ctx);
    const vehicle = await getOwned(ctx, companyId, vehicleId);
    if (!vehicle) throw new ConvexError("El vehículo ya no existe.");

    const clean = cleanName(name);
    const key = normalizeKey(clean);
    if (!key) throw new ConvexError("El nombre no puede estar vacío.");

    const clash = await vehicleNamed(ctx, companyId, key);
    if (clash && clash._id !== vehicleId) {
      throw new ConvexError(`Ya existe el vehículo "${clash.name}".`);
    }

    await ctx.db.patch(vehicleId, { name: clean, normalizedName: key });
    const deliveries = await ctx.db
      .query("deliveries")
      .withIndex("by_vehicle", (q) => q.eq("vehicleId", vehicleId))
      .collect();
    for (const d of deliveries) {
      await ctx.db.patch(d._id, { vehicleName: clean });
    }
  },
});

/** "Eliminar" archives the vehicle (past deliveries keep it); "Restaurar" brings it back. */
export const setActive = mutation({
  args: { vehicleId: v.id("vehicles"), active: v.boolean() },
  handler: async (ctx, { vehicleId, active }) => {
    const { companyId } = await requireOffice(ctx);
    const vehicle = await getOwned(ctx, companyId, vehicleId);
    if (!vehicle) throw new ConvexError("El vehículo ya no existe.");
    await ctx.db.patch(vehicleId, { active });
  },
});
