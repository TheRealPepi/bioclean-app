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

export default defineSchema({
  ...authTables,

  clients: defineTable({
    // Display name, uppercased and whitespace-collapsed.
    name: v.string(),
    // Accent/punctuation-insensitive key used to detect duplicates.
    normalizedName: v.string(),
    deliveryCount: v.number(),
    lastDeliveryAt: v.optional(v.number()),
  }).index("by_normalized", ["normalizedName"]),

  deliveries: defineTable({
    clientId: v.id("clients"),
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
    .index("by_client_request", ["clientRequestId"]),
});
