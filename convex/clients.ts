import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { requireAdmin, requireUser } from "./lib/access";
import { cleanName, normalizeKey } from "./lib/text";

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const clients = await ctx.db.query("clients").collect();
    return clients
      .map((c) => ({
        _id: c._id,
        name: c.name,
        deliveryCount: c.deliveryCount,
        lastDeliveryAt: c.lastDeliveryAt ?? null,
        location: c.location ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  },
});

/** Returns the client matching `name` (ignoring accents/punctuation), creating it if needed. */
export async function findOrCreateClient(ctx: MutationCtx, name: string) {
  const clean = cleanName(name);
  const key = normalizeKey(clean);
  if (!key) throw new ConvexError("Escribe el nombre del cliente.");
  const existing = await ctx.db
    .query("clients")
    .withIndex("by_normalized", (q) => q.eq("normalizedName", key))
    .first();
  if (existing) return existing;
  const id = await ctx.db.insert("clients", {
    name: clean,
    normalizedName: key,
    deliveryCount: 0,
  });
  return (await ctx.db.get(id))!;
}

async function setDeliveriesClient(
  ctx: MutationCtx,
  fromId: Id<"clients">,
  toId: Id<"clients">,
  toName: string,
) {
  const deliveries = await ctx.db
    .query("deliveries")
    .withIndex("by_client", (q) => q.eq("clientId", fromId))
    .collect();
  for (const d of deliveries) {
    await ctx.db.patch(d._id, { clientId: toId, clientName: toName });
  }
}

export const rename = mutation({
  args: { clientId: v.id("clients"), name: v.string() },
  handler: async (ctx, { clientId, name }) => {
    await requireAdmin(ctx);
    const client = await ctx.db.get(clientId);
    if (!client) throw new ConvexError("El cliente ya no existe.");

    const clean = cleanName(name);
    const key = normalizeKey(clean);
    if (!key) throw new ConvexError("El nombre no puede estar vacío.");

    const clash = await ctx.db
      .query("clients")
      .withIndex("by_normalized", (q) => q.eq("normalizedName", key))
      .first();
    if (clash && clash._id !== clientId) {
      throw new ConvexError(
        `Ya existe el cliente "${clash.name}". Usa "Fusionar" para unirlos.`,
      );
    }

    await ctx.db.patch(clientId, { name: clean, normalizedName: key });
    await setDeliveriesClient(ctx, clientId, clientId, clean);
  },
});

/** Moves every delivery of `fromId` to `intoId` and deletes `fromId`. */
export const merge = mutation({
  args: { fromId: v.id("clients"), intoId: v.id("clients") },
  handler: async (ctx, { fromId, intoId }) => {
    await requireAdmin(ctx);
    if (fromId === intoId) throw new ConvexError("Elige un cliente distinto.");
    const from = await ctx.db.get(fromId);
    const into = await ctx.db.get(intoId);
    if (!from || !into) throw new ConvexError("El cliente ya no existe.");

    await setDeliveriesClient(ctx, fromId, intoId, into.name);
    await ctx.db.patch(intoId, {
      deliveryCount: into.deliveryCount + from.deliveryCount,
      lastDeliveryAt: Math.max(into.lastDeliveryAt ?? 0, from.lastDeliveryAt ?? 0) || undefined,
      location: into.location ?? from.location,
    });
    await ctx.db.delete(fromId);
  },
});

/** For a client who moved: the next delivery records a new saved location. */
export const clearLocation = mutation({
  args: { clientId: v.id("clients") },
  handler: async (ctx, { clientId }) => {
    await requireAdmin(ctx);
    const client = await ctx.db.get(clientId);
    if (!client) throw new ConvexError("El cliente ya no existe.");
    await ctx.db.patch(clientId, { location: undefined });
  },
});

/**
 * Run once after deploying saved client locations, so existing clients get the
 * location of their latest delivery: `npx convex run clients:backfillLocations`
 * (add `--prod` for production). Safe to run again.
 */
export const backfillLocations = internalMutation({
  args: {},
  handler: async (ctx) => {
    let updated = 0;
    for (const client of await ctx.db.query("clients").collect()) {
      if (client.location) continue;
      const latest = await ctx.db
        .query("deliveries")
        .withIndex("by_client", (q) => q.eq("clientId", client._id))
        .order("desc")
        .first();
      if (!latest) continue;
      await ctx.db.patch(client._id, { location: latest.location });
      updated++;
    }
    return { updated };
  },
});
