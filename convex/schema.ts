import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const deliveryStatus = v.union(
  v.literal("exitosa"),
  v.literal("faltante"),
  v.literal("cambio_mercancia"),
  v.literal("cambio_factura"),
  v.literal("no_recibido"),
);

export const paymentType = v.union(v.literal("pagado"), v.literal("credito"));

/**
 * Where a delivery's location came from:
 * - guardada: the client's saved location (the driver confirmed it, or was there).
 * - modificada: the driver captured a different point for this delivery only.
 * - nueva: the client had no saved location; this one became it.
 */
export const locationSource = v.union(
  v.literal("guardada"),
  v.literal("modificada"),
  v.literal("nueva"),
);

export const locationObj = v.object({
  lat: v.number(),
  lng: v.number(),
  accuracy: v.optional(v.number()),
});

export default defineSchema({
  ...authTables,

  clients: defineTable({
    // Display name, uppercased and whitespace-collapsed.
    name: v.string(),
    // Accent/punctuation-insensitive key used to detect duplicates.
    normalizedName: v.string(),
    deliveryCount: v.number(),
    lastDeliveryAt: v.optional(v.number()),
    // Usual delivery location, shown to the driver to confirm or modify.
    location: v.optional(locationObj),
  }).index("by_normalized", ["normalizedName"]),

  vehicles: defineTable({
    name: v.string(),
    normalizedName: v.string(),
    // Removed vehicles are archived so past deliveries keep them.
    active: v.boolean(),
  }).index("by_normalized", ["normalizedName"]),

  // One row per factura number, so the duplicate warning can find any number
  // of a delivery with several facturas (arrays can't be indexed).
  invoiceNumbers: defineTable({
    number: v.string(),
    deliveryId: v.id("deliveries"),
  }).index("by_number", ["number"]),

  deliveries: defineTable({
    clientId: v.id("clients"),
    clientName: v.string(),
    // Every factura number joined with ", " (used for display and search).
    invoiceNumber: v.string(),
    invoices: v.optional(v.array(v.object({ number: v.string(), photoId: v.id("_storage") }))),
    // Only deliveries from before several facturas were allowed.
    invoicePhotoId: v.optional(v.id("_storage")),
    receiverPhotoId: v.id("_storage"),
    goodsPhotoId: v.id("_storage"),
    location: locationObj,
    locationSource: v.optional(locationSource),
    // GPS position of the driver taken in the background when they confirmed
    // the client's saved location, as proof they were there.
    driverPosition: v.optional(locationObj),
    vehicleId: v.optional(v.id("vehicles")),
    vehicleName: v.optional(v.string()),
    payment: v.optional(paymentType),
    status: deliveryStatus,
    notes: v.string(),
    driverId: v.id("users"),
    driverName: v.string(),
    // When the driver recorded it on the phone. Can be earlier than
    // _creationTime if it was saved without signal and uploaded later.
    // Rows from before offline mode get it from `backfillDeliveredAt`.
    deliveredAt: v.optional(v.number()),
    // Random id generated on the phone so a retried upload never creates the
    // same delivery twice.
    clientRequestId: v.optional(v.string()),
  })
    .index("by_driver", ["driverId", "deliveredAt"])
    .index("by_delivered", ["deliveredAt"])
    .index("by_client", ["clientId"])
    .index("by_invoice", ["invoiceNumber"])
    .index("by_vehicle", ["vehicleId"])
    .index("by_client_request", ["clientRequestId"]),
});
