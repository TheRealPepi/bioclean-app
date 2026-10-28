import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { findOrCreateClient } from "./clients";
import { displayName, requireAdmin, requireUser } from "./lib/access";
import { cleanInvoice } from "./lib/text";
import { deliveryStatus } from "./schema";

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
  },
  handler: async (ctx, args) => {
    const { user } = await requireUser(ctx);

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
    });

    await ctx.db.patch(client._id, {
      deliveryCount: client.deliveryCount + 1,
      lastDeliveryAt: Date.now(),
    });

    return id;
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
    return { clientName: existing.clientName, createdAt: existing._creationTime };
  },
});

/** The current driver's deliveries since `since` (start of today, computed by the client). */
export const listMine = query({
  args: { since: v.number() },
  handler: async (ctx, { since }) => {
    const { user } = await requireUser(ctx);
    const deliveries = await ctx.db
      .query("deliveries")
      .withIndex("by_driver", (q) => q.eq("driverId", user._id).gte("_creationTime", since))
      .order("desc")
      .collect();
    return deliveries.map((d) => ({
      _id: d._id,
      _creationTime: d._creationTime,
      clientName: d.clientName,
      invoiceNumber: d.invoiceNumber,
      status: d.status,
    }));
  },
});

/** Admin table: every delivery created in [from, to), newest first. */
export const list = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, { from, to }) => {
    await requireAdmin(ctx);
    const deliveries = await ctx.db
      .query("deliveries")
      .withIndex("by_creation_time", (q) => q.gte("_creationTime", from).lt("_creationTime", to))
      .order("desc")
      .take(5000);
    return deliveries.map((d) => ({
      _id: d._id,
      _creationTime: d._creationTime,
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
      photos: {
        invoice: await url(delivery.invoicePhotoId),
        receiver: await url(delivery.receiverPhotoId),
        goods: await url(delivery.goodsPhotoId),
      },
    };
  },
});
