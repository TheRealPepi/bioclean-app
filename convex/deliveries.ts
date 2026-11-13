import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query } from "./_generated/server";
import { findOrCreateClient } from "./clients";
import { displayName, requireAdmin, requireUser } from "./lib/access";
import { distanceMeters, SAME_PLACE_METERS } from "./lib/geo";
import { cleanInvoice } from "./lib/text";
import { deliveryStatus, locationObj, locationSource, paymentType } from "./schema";

/** Rows from before offline mode may not have `deliveredAt` until the backfill runs. */
const deliveredAt = (d: Doc<"deliveries">) => d.deliveredAt ?? d._creationTime;

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

const invoiceArg = v.object({ number: v.string(), photoId: v.id("_storage") });

export const create = mutation({
  args: {
    // The selected client; if missing (e.g. merged meanwhile) we fall back to clientName.
    clientId: v.optional(v.id("clients")),
    clientName: v.string(),
    invoices: v.optional(v.array(invoiceArg)),
    // Single factura, sent by app versions from before several facturas were allowed.
    invoiceNumber: v.optional(v.string()),
    invoicePhotoId: v.optional(v.id("_storage")),
    receiverPhotoId: v.id("_storage"),
    goodsPhotoId: v.id("_storage"),
    location: locationObj,
    locationSource: v.optional(locationSource),
    driverPosition: v.optional(locationObj),
    vehicleId: v.optional(v.id("vehicles")),
    payment: v.optional(paymentType),
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

    const rawInvoices =
      args.invoices ??
      (args.invoiceNumber !== undefined && args.invoicePhotoId
        ? [{ number: args.invoiceNumber, photoId: args.invoicePhotoId }]
        : []);
    const invoices = rawInvoices.map((i) => ({ ...i, number: cleanInvoice(i.number) }));
    if (invoices.length === 0 || invoices.some((i) => !i.number)) {
      throw new ConvexError("Falta el número de factura.");
    }
    const numbers = invoices.map((i) => i.number);
    if (new Set(numbers).size !== numbers.length) {
      throw new ConvexError("Hay un número de factura repetido en esta entrega.");
    }

    const notes = args.notes.trim();
    if (args.status !== "exitosa" && !notes) {
      throw new ConvexError("Describe en las anotaciones qué pasó con la entrega.");
    }

    const photoIds = [...invoices.map((i) => i.photoId), args.receiverPhotoId, args.goodsPhotoId];
    for (const photoId of photoIds) {
      if ((await ctx.db.system.get(photoId)) === null) {
        throw new ConvexError("Una de las fotos no se subió correctamente. Inténtalo de nuevo.");
      }
    }

    const selected = args.clientId ? await ctx.db.get(args.clientId) : null;
    const client = selected ?? (await findOrCreateClient(ctx, args.clientName));

    // Archived vehicles are accepted: it may have been chosen offline before.
    const vehicle = args.vehicleId ? await ctx.db.get(args.vehicleId) : null;

    // The server decides the final source from the client's saved location.
    let source: Doc<"deliveries">["locationSource"];
    if (!client.location) source = "nueva";
    else if (args.locationSource === "guardada") source = "guardada";
    else {
      source =
        distanceMeters(client.location, args.location) > SAME_PLACE_METERS
          ? "modificada"
          : "guardada";
    }

    // Never in the future, in case the phone's clock is ahead.
    const now = Date.now();
    const when = Math.min(args.deliveredAt ?? now, now);

    const id = await ctx.db.insert("deliveries", {
      clientId: client._id,
      clientName: client.name,
      invoiceNumber: numbers.join(", "),
      invoices,
      receiverPhotoId: args.receiverPhotoId,
      goodsPhotoId: args.goodsPhotoId,
      location: args.location,
      locationSource: source,
      driverPosition: args.locationSource === "guardada" ? args.driverPosition : undefined,
      vehicleId: vehicle?._id,
      vehicleName: vehicle?.name,
      payment: args.payment,
      status: args.status,
      notes,
      driverId: user._id,
      driverName: displayName(user),
      deliveredAt: when,
      clientRequestId: args.clientRequestId,
    });

    for (const number of numbers) {
      await ctx.db.insert("invoiceNumbers", { number, deliveryId: id });
    }

    await ctx.db.patch(client._id, {
      deliveryCount: client.deliveryCount + 1,
      lastDeliveryAt: Math.max(client.lastDeliveryAt ?? 0, when),
      ...(client.location ? {} : { location: args.location }),
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
    const row = await ctx.db
      .query("invoiceNumbers")
      .withIndex("by_number", (q) => q.eq("number", invoiceNumber))
      .first();
    // Deliveries from before several facturas were allowed have no rows there.
    const existing = row
      ? await ctx.db.get(row.deliveryId)
      : await ctx.db
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
      locationSource: d.locationSource ?? null,
      vehicleName: d.vehicleName ?? null,
      payment: d.payment ?? null,
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
    const invoices =
      delivery.invoices ??
      (delivery.invoicePhotoId
        ? [{ number: delivery.invoiceNumber, photoId: delivery.invoicePhotoId }]
        : []);
    const {
      invoices: _invoices,
      invoicePhotoId: _invoicePhotoId,
      receiverPhotoId: _receiverPhotoId,
      goodsPhotoId: _goodsPhotoId,
      ...rest
    } = delivery;
    return {
      ...rest,
      deliveredAt: deliveredAt(delivery),
      vehicleName: delivery.vehicleName ?? null,
      payment: delivery.payment ?? null,
      locationSource: delivery.locationSource ?? null,
      driverPosition: delivery.driverPosition ?? null,
      invoices: await Promise.all(
        invoices.map(async (i) => ({ number: i.number, url: await url(i.photoId) })),
      ),
      photos: {
        receiver: await url(delivery.receiverPhotoId),
        goods: await url(delivery.goodsPhotoId),
      },
    };
  },
});
