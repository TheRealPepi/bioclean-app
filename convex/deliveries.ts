import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query } from "./_generated/server";
import { findOrCreateClient } from "./clients";
import { displayName, requireAdmin, requireUser } from "./lib/access";
import { cleanInvoice } from "./lib/text";
import { deliveryStatus } from "./schema";

/** Rows from before offline mode may not have `deliveredAt` until the backfill runs. */
const deliveredAt = (d: Doc<"deliveries">) => d.deliveredAt ?? d._creationTime;

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const create = mutation({
  args: {
    // The selected client; if missing (e.g. merged meanwhile) we fall back to clientName.
    clientId: v.optional(v.id("clients")),
    clientName: v.string(),
    invoiceNumber: v.string(),
    invoicePhotoId: v.id("_storage"),
    receiverPhotoId: v.id("_storage"),
    goodsPhotoId: v.id("_storage"),
    location: v.object({
      lat: v.number(),
      lng: v.number(),
      accuracy: v.optional(v.number()),
    }),
    status: deliveryStatus,
    notes: v.string(),
    // Set by the phone's outbox (see src/lib/outbox.ts).
    deliveredAt: v.optional(v.number()),
    clientRequestId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);

    // A retry of an upload whose response got lost: it's already saved.
    if (args.clientRequestId) {
      const existing = await ctx.db
        .query("deliveries")
        .withIndex("by_client_request", (q) => q.eq("clientRequestId", args.clientRequestId))
        .first();
      if (existing) return existing._id;
    }

    const invoiceNumber = cleanInvoice(args.invoiceNumber);
    if (!invoiceNumber) throw new ConvexError("Falta el número de factura.");

    const notes = args.notes.trim();
    if (args.status !== "exitosa" && !notes) {
      throw new ConvexError("Describe en las anotaciones qué pasó con la entrega.");
    }

    for (const photoId of [args.invoicePhotoId, args.receiverPhotoId, args.goodsPhotoId]) {
      if ((await ctx.db.system.get(photoId)) === null) {
        throw new ConvexError("Una de las fotos no se subió correctamente. Inténtalo de nuevo.");
      }
    }

    const selected = args.clientId ? await ctx.db.get(args.clientId) : null;
    const client = selected ?? (await findOrCreateClient(ctx, args.clientName));

    // Never in the future, in case the phone's clock is ahead.
    const now = Date.now();
    const when = Math.min(args.deliveredAt ?? now, now);

    const id = await ctx.db.insert("deliveries", {
      clientId: client._id,
      clientName: client.name,
      invoiceNumber,
      invoicePhotoId: args.invoicePhotoId,
      receiverPhotoId: args.receiverPhotoId,
      goodsPhotoId: args.goodsPhotoId,
      location: args.location,
      status: args.status,
      notes,
      driverId: user._id,
      driverName: displayName(user),
      deliveredAt: when,
      clientRequestId: args.clientRequestId,
    });

    await ctx.db.patch(client._id, {
      deliveryCount: client.deliveryCount + 1,
      lastDeliveryAt: Math.max(client.lastDeliveryAt ?? 0, when),
    });

    return id;
  },
});

/**
 * Run once right after deploying offline mode, so older deliveries show up in
 * the date-filtered lists: `npx convex run deliveries:backfillDeliveredAt`
 * (add `--prod` for production). Safe to run again.
 */
export const backfillDeliveredAt = internalMutation({
  args: {},
  handler: async (ctx) => {
    const missing = await ctx.db
      .query("deliveries")
      .withIndex("by_delivered", (q) => q.eq("deliveredAt", undefined))
      .take(2000);
    for (const d of missing) {
      await ctx.db.patch(d._id, { deliveredAt: d._creationTime });
    }
    return { updated: missing.length, done: missing.length < 2000 };
  },
});

/** Used by the wizard to warn (not block) when an invoice was already registered. */
export const findByInvoice = query({
  args: { invoiceNumber: v.string() },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const invoiceNumber = cleanInvoice(args.invoiceNumber);
    if (!invoiceNumber) return null;
    const existing = await ctx.db
      .query("deliveries")
      .withIndex("by_invoice", (q) => q.eq("invoiceNumber", invoiceNumber))
      .first();
    if (!existing) return null;
    return { clientName: existing.clientName, createdAt: deliveredAt(existing) };
  },
});

/** The current driver's deliveries since `since` (start of today, computed by the client). */
export const listMine = query({
  args: { since: v.number() },
  handler: async (ctx, { since }) => {
    const { user } = await requireUser(ctx);
    const deliveries = await ctx.db
      .query("deliveries")
      .withIndex("by_driver", (q) => q.eq("driverId", user._id).gte("deliveredAt", since))
      .order("desc")
      .collect();
    return deliveries.map((d) => ({
      _id: d._id,
      deliveredAt: deliveredAt(d),
      clientName: d.clientName,
      invoiceNumber: d.invoiceNumber,
      status: d.status,
    }));
  },
});

/** Admin table: every delivery made in [from, to), newest first. */
export const list = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, { from, to }) => {
    await requireAdmin(ctx);
    const deliveries = await ctx.db
      .query("deliveries")
      .withIndex("by_delivered", (q) => q.gte("deliveredAt", from).lt("deliveredAt", to))
      .order("desc")
      .take(5000);
    return deliveries.map((d) => ({
      _id: d._id,
      deliveredAt: deliveredAt(d),
      clientName: d.clientName,
      invoiceNumber: d.invoiceNumber,
      driverId: d.driverId,
      driverName: d.driverName,
      status: d.status,
      notes: d.notes,
      location: d.location,
    }));
  },
});

export const get = query({
  args: { id: v.string() },
  handler: async (ctx, args) => {
    const { user, role } = await requireUser(ctx);
    const id = ctx.db.normalizeId("deliveries", args.id);
    const delivery = id ? await ctx.db.get(id) : null;
    if (!delivery || (role !== "admin" && delivery.driverId !== user._id)) {
      return null;
    }
    const url = (storageId: Id<"_storage">) => ctx.storage.getUrl(storageId);
    return {
      ...delivery,
      deliveredAt: deliveredAt(delivery),
      photos: {
        invoice: await url(delivery.invoicePhotoId),
        receiver: await url(delivery.receiverPhotoId),
        goods: await url(delivery.goodsPhotoId),
      },
    };
  },
});
