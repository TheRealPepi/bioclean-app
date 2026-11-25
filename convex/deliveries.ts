import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type QueryCtx } from "./_generated/server";
import { findOrCreateClient } from "./clients";
import { displayName, requireAdmin, requireUser } from "./lib/access";
import { dueDateFor } from "./lib/due";
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

/** The latest deliveries that have this (already cleaned) factura number, newest first. */
async function deliveriesWithInvoice(ctx: QueryCtx, number: string) {
  const found = new Map<Id<"deliveries">, Doc<"deliveries">>();
  const rows = await ctx.db
    .query("invoiceNumbers")
    .withIndex("by_number", (q) => q.eq("number", number))
    .order("desc")
    .take(20);
  for (const row of rows) {
    const delivery = await ctx.db.get(row.deliveryId);
    if (delivery) found.set(delivery._id, delivery);
  }
  // Deliveries from before several facturas were allowed have no rows there.
  const older = await ctx.db
    .query("deliveries")
    .withIndex("by_invoice", (q) => q.eq("invoiceNumber", number))
    .order("desc")
    .take(20);
  for (const delivery of older) found.set(delivery._id, delivery);
  return [...found.values()].sort((a, b) => b._creationTime - a._creationTime);
}

/** "posible_duplicado" wins: it's the one the office has to look at. */
function deliveryRepeat(d: Doc<"deliveries">) {
  const repeats = (d.invoices ?? []).map((i) => i.repeat);
  if (repeats.includes("posible_duplicado")) return "posible_duplicado" as const;
  if (repeats.includes("seguimiento")) return "seguimiento" as const;
  return null;
}

const invoiceArg = v.object({
  number: v.string(),
  photoId: v.id("_storage"),
  // The driver confirmed this factura follows up an earlier delivery.
  followUp: v.optional(v.boolean()),
});

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
    // What the client wrote happened, when they chose a problem after signing.
    clientNotes: v.optional(v.string()),
    // The app always sends it. Still optional here so deliveries saved on a
    // phone with an app version from before signatures can upload.
    signature: v.optional(v.object({ photoId: v.id("_storage"), signedAt: v.number() })),
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

    const rawInvoices: { number: string; photoId: Id<"_storage">; followUp?: boolean }[] =
      args.invoices ??
      (args.invoiceNumber !== undefined && args.invoicePhotoId
        ? [{ number: args.invoiceNumber, photoId: args.invoicePhotoId }]
        : []);
    const cleaned = rawInvoices.map((i) => ({ ...i, number: cleanInvoice(i.number) }));
    if (cleaned.length === 0 || cleaned.some((i) => !i.number)) {
      throw new ConvexError("Falta el número de factura.");
    }
    const numbers = cleaned.map((i) => i.number);
    if (new Set(numbers).size !== numbers.length) {
      throw new ConvexError("Hay un número de factura repetido en esta entrega.");
    }

    const notes = args.notes.trim();
    // The client picks the problem with a tap; an explanation only comes from
    // older app versions, which asked the client to type one.
    const clientNotes = args.status === "exitosa" ? "" : (args.clientNotes ?? "").trim();

    const photoIds = [
      ...cleaned.map((i) => i.photoId),
      args.receiverPhotoId,
      args.goodsPhotoId,
      ...(args.signature ? [args.signature.photoId] : []),
    ];
    for (const photoId of photoIds) {
      if ((await ctx.db.system.get(photoId)) === null) {
        throw new ConvexError("Una de las fotos no se subió correctamente. Inténtalo de nuevo.");
      }
    }

    const selected = args.clientId ? await ctx.db.get(args.clientId) : null;
    const client = selected ?? (await findOrCreateClient(ctx, args.clientName));

    // A repeated factura is never rejected: the delivery already happened, and
    // the wizard can't ask without signal. It's marked for the office instead.
    // Only a delivery to the same client can be followed up; the same number
    // for another client is always a possible duplicate.
    const invoices: NonNullable<Doc<"deliveries">["invoices"]> = [];
    for (const { number, photoId, followUp } of cleaned) {
      const earlier = await deliveriesWithInvoice(ctx, number);
      const sameClient = earlier.find((d) => d.clientId === client._id);
      const previous = sameClient ?? earlier[0];
      const isFollowUp = followUp === true && (sameClient !== undefined || !previous);
      invoices.push({
        number,
        photoId,
        ...(isFollowUp
          ? { repeat: "seguimiento" as const }
          : previous
            ? { repeat: "posible_duplicado" as const }
            : {}),
        ...(previous ? { previousDeliveryId: previous._id } : {}),
      });
    }

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
      clientNotes: clientNotes || undefined,
      signature: args.signature && {
        photoId: args.signature.photoId,
        signedAt: Math.min(args.signature.signedAt, now),
      },
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

/** Lets the admin mark a "credito" delivery as paid (or undo it). */
export const setPayment = mutation({
  args: { id: v.id("deliveries"), payment: paymentType },
  handler: async (ctx, { id, payment }) => {
    await requireAdmin(ctx);
    const delivery = await ctx.db.get(id);
    if (!delivery) throw new ConvexError("La entrega ya no existe.");
    if (delivery.payment === payment) return;
    await ctx.db.patch(id, {
      payment,
      paidAt: payment === "pagado" ? Date.now() : undefined,
    });
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

/** Only called by app versions from before the "¿es seguimiento?" question. */
export const findByInvoice = query({
  args: { invoiceNumber: v.string() },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const invoiceNumber = cleanInvoice(args.invoiceNumber);
    if (!invoiceNumber) return null;
    const [existing] = await deliveriesWithInvoice(ctx, invoiceNumber);
    if (!existing) return null;
    return { clientName: existing.clientName, createdAt: deliveredAt(existing) };
  },
});

/**
 * Used by the wizard to ask whether a factura that was already registered (by
 * any driver) is a follow-up. One entry per number; `earlier` has the latest
 * deliveries with it, newest first (empty when the number is new). The wizard
 * picks the one for the same client, since only that one can be followed up.
 */
export const findByInvoices = query({
  args: { numbers: v.array(v.string()) },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const numbers = [...new Set(args.numbers.map(cleanInvoice).filter(Boolean))].slice(0, 50);
    return await Promise.all(
      numbers.map(async (number) => {
        const existing = await deliveriesWithInvoice(ctx, number);
        return {
          number,
          earlier: existing.map((d) => ({
            clientId: d.clientId,
            clientName: d.clientName,
            createdAt: deliveredAt(d),
            driverName: d.driverName,
            status: d.status,
          })),
        };
      }),
    );
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
      repeat: deliveryRepeat(d),
      driverId: d.driverId,
      driverName: d.driverName,
      status: d.status,
      notes: d.notes,
      location: d.location,
      locationSource: d.locationSource ?? null,
      vehicleName: d.vehicleName ?? null,
      payment: d.payment ?? null,
      // false only on deliveries from before signatures.
      signed: d.signature !== undefined,
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
    const invoices: NonNullable<Doc<"deliveries">["invoices"]> =
      delivery.invoices ??
      (delivery.invoicePhotoId
        ? [{ number: delivery.invoiceNumber, photoId: delivery.invoicePhotoId }]
        : []);
    const {
      invoices: _invoices,
      invoicePhotoId: _invoicePhotoId,
      receiverPhotoId: _receiverPhotoId,
      goodsPhotoId: _goodsPhotoId,
      signature,
      reminded,
      ...rest
    } = delivery;

    // Payment deadline and reminders are for the office only.
    const isAdmin = role === "admin";
    let dueDate: string | null = null;
    if (isAdmin && delivery.payment === "credito") {
      const client = await ctx.db.get(delivery.clientId);
      if (client?.creditDays) {
        dueDate = dueDateFor(deliveredAt(delivery), client.creditDays);
      }
    }

    return {
      ...rest,
      deliveredAt: deliveredAt(delivery),
      vehicleName: delivery.vehicleName ?? null,
      payment: delivery.payment ?? null,
      paidAt: delivery.paidAt ?? null,
      isAdmin,
      dueDate,
      reminded: isAdmin ? (reminded ?? []) : [],
      locationSource: delivery.locationSource ?? null,
      driverPosition: delivery.driverPosition ?? null,
      signature: signature
        ? {
            url: await url(signature.photoId),
            signedAt: signature.signedAt,
          }
        : null,
      invoices: await Promise.all(
        invoices.map(async (i) => {
          const previous = i.previousDeliveryId ? await ctx.db.get(i.previousDeliveryId) : null;
          return {
            number: i.number,
            url: await url(i.photoId),
            repeat: i.repeat ?? null,
            previous: previous && {
              // Only when this user can open it (drivers only see their own).
              id: isAdmin || previous.driverId === user._id ? previous._id : null,
              deliveredAt: deliveredAt(previous),
              // Only when it was for another client (never a follow-up then).
              otherClientName: previous.clientId === delivery.clientId ? null : previous.clientName,
              driverName: previous.driverName,
              status: previous.status,
            },
          };
        }),
      ),
      photos: {
        receiver: await url(delivery.receiverPhotoId),
        goods: await url(delivery.goodsPhotoId),
      },
    };
  },
});
