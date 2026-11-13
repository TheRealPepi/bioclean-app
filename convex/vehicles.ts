import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin, requireUser } from "./lib/access";
import { cleanName, normalizeKey } from "./lib/text";

/** Every vehicle, archived included (drivers only show the active ones). */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const vehicles = await ctx.db.query("vehicles").collect();
    return vehicles
      .map((veh) => ({ _id: veh._id, name: veh.name, active: veh.active }))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  },
});

export const create = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    await requireAdmin(ctx);
    const clean = cleanName(name);
    const key = normalizeKey(clean);
    if (!key) throw new ConvexError("Escribe el nombre del vehículo.");
    const existing = await ctx.db
      .query("vehicles")
      .withIndex("by_normalized", (q) => q.eq("normalizedName", key))
      .first();
    if (existing?.active) throw new ConvexError(`Ya existe el vehículo "${existing.name}".`);
    if (existing) {
      // Same name as a removed one: bring it back.
      await ctx.db.patch(existing._id, { active: true });
      return existing._id;
    }
    return await ctx.db.insert("vehicles", { name: clean, normalizedName: key, active: true });
  },
});

export const rename = mutation({
  args: { vehicleId: v.id("vehicles"), name: v.string() },
  handler: async (ctx, { vehicleId, name }) => {
    await requireAdmin(ctx);
    const vehicle = await ctx.db.get(vehicleId);
    if (!vehicle) throw new ConvexError("El vehículo ya no existe.");

    const clean = cleanName(name);
    const key = normalizeKey(clean);
    if (!key) throw new ConvexError("El nombre no puede estar vacío.");

    const clash = await ctx.db
      .query("vehicles")
      .withIndex("by_normalized", (q) => q.eq("normalizedName", key))
      .first();
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
    await requireAdmin(ctx);
    const vehicle = await ctx.db.get(vehicleId);
    if (!vehicle) throw new ConvexError("El vehículo ya no existe.");
    await ctx.db.patch(vehicleId, { active });
  },
});
