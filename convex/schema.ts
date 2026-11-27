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

/** Where a client gets payment reminders. Not set = no reminders. */
export const notifyChannel = v.union(
  v.literal("email"),
  v.literal("whatsapp"),
  v.literal("ambos"),
);

export const reminderChannel = v.union(v.literal("email"), v.literal("whatsapp"));

/**
 * - semana_antes: the payment deadline is within a week.
 * - vencimiento: the deadline is today (or was in the last few days, if an
 *   earlier attempt failed).
 * - prueba: sent by the admin from the client's settings.
 */
export const reminderKind = v.union(
  v.literal("semana_antes"),
  v.literal("vencimiento"),
  v.literal("prueba"),
);

/**
 * Set on a factura whose number was already in an earlier delivery:
 * - seguimiento: the driver confirmed it follows up that delivery.
 * - posible_duplicado: nobody confirmed it (registered without signal, or two
 *   drivers registered it at the same time), so the office should check it.
 */
export const invoiceRepeat = v.union(v.literal("seguimiento"), v.literal("posible_duplicado"));

export const locationObj = v.object({
  lat: v.number(),
  lng: v.number(),
  accuracy: v.optional(v.number()),
});

/** One stop of a route. Name and location are copied from the client when the route is created. */
export const routeStop = v.object({
  clientId: v.id("clients"),
  clientName: v.string(),
  location: locationObj,
  // The office chose this location for this route: it isn't the client's saved one.
  customLocation: v.optional(v.boolean()),
});

/** What a member can do in their company (see `convex/lib/access.ts`). */
export const memberRole = v.union(
  v.literal("owner"),
  v.literal("admin"),
  v.literal("office"),
  v.literal("driver"),
);

/** Where a company delivers: address search stays inside `bounds`, maps open on `center`. */
export const serviceArea = v.object({
  center: v.object({ lat: v.number(), lng: v.number() }),
  bounds: v.object({
    west: v.number(),
    south: v.number(),
    east: v.number(),
    north: v.number(),
  }),
});

/** How a company sends its payment reminders. */
export const companyReminders = v.object({
  // First delivery day ("YYYY-MM-DD") that gets reminders. Not set = reminders off.
  startDate: v.optional(v.string()),
  // The sender is `fromName <fromLocalPart@senderDomain>`.
  fromName: v.optional(v.string()),
  fromLocalPart: v.optional(v.string()),
  replyTo: v.optional(v.string()),
  // The token is in `companySecrets`.
  whatsapp: v.optional(
    v.object({
      phoneNumberId: v.string(),
      templateVencimiento: v.optional(v.string()),
      templateProximo: v.optional(v.string()),
      lang: v.optional(v.string()),
    }),
  ),
});

// The company a row belongs to. Every function reads and writes only the rows
// of the caller's company (see `convex/lib/access.ts`).
const companyId = v.id("companies");

export default defineSchema({
  ...authTables,

  companies: defineTable({
    name: v.string(),
    // IANA zone ("America/Cancun"): days and deadlines are in the company's time.
    timeZone: v.string(),
    // Added to WhatsApp numbers written without one ("52").
    phoneCountryCode: v.string(),
    // Line under the company name in reminder emails.
    tagline: v.optional(v.string()),
    // Where routes start (the warehouse).
    base: v.optional(locationObj),
    serviceArea: v.optional(serviceArea),
    // Email domain verified for this company in Resend. Never set from the
    // app: a company must not be able to send as another one's domain.
    senderDomain: v.optional(v.string()),
    reminders: v.optional(companyReminders),
    // Local day ("YYYY-MM-DD") of the last reminders run.
    remindersLastRunOn: v.optional(v.string()),
  }),

  // Apart from `companies` so no query returns them by accident.
  companySecrets: defineTable({
    companyId: v.id("companies"),
    whatsappToken: v.optional(v.string()),
  }).index("by_company", ["companyId"]),

  // Who can use the app: an email (of a Google account) with a role in one
  // company. An email is in at most one company.
  members: defineTable({
    companyId: v.id("companies"),
    // Trimmed and lowercased.
    email: v.string(),
    role: memberRole,
    addedBy: v.optional(v.id("users")),
  })
    .index("by_email", ["email"])
    .index("by_company", ["companyId"]),

  // A route the office planned for one driver. Whether a stop is delivered is
  // not stored: it's worked out from the deliveries made after the route was
  // created (see `convex/routes.ts`).
  routes: defineTable({
    companyId,
    driverId: v.id("users"),
    driverName: v.string(),
    // In visit order.
    stops: v.array(routeStop),
    // The base when the route was created.
    base: v.optional(locationObj),
    returnToBase: v.boolean(),
    // Drivers stop seeing the route after this; a daily job deletes it later.
    expiresAt: v.number(),
  })
    .index("by_expires", ["expiresAt"])
    .index("by_company", ["companyId"])
    .index("by_company_driver", ["companyId", "driverId", "expiresAt"]),

  clients: defineTable({
    companyId,
    // Display name, uppercased and whitespace-collapsed.
    name: v.string(),
    // Accent/punctuation-insensitive key used to detect duplicates.
    normalizedName: v.string(),
    deliveryCount: v.number(),
    lastDeliveryAt: v.optional(v.number()),
    // Usual delivery location, shown to the driver to confirm or modify.
    location: v.optional(locationObj),
    // Payment reminders (admin only: never returned to drivers, see `clients.list`).
    email: v.optional(v.string()),
    // Digits only, with country code and no "+": "529871234567".
    whatsapp: v.optional(v.string()),
    // Days between the delivery and the payment deadline of a "credito" delivery.
    creditDays: v.optional(v.number()),
    notifyBy: v.optional(notifyChannel),
  })
    .index("by_company_normalized", ["companyId", "normalizedName"]),

  vehicles: defineTable({
    companyId,
    name: v.string(),
    normalizedName: v.string(),
    // Removed vehicles are archived so past deliveries keep them.
    active: v.boolean(),
  })
    .index("by_company_normalized", ["companyId", "normalizedName"]),

  // One row per factura number, so the duplicate warning can find any number
  // of a delivery with several facturas (arrays can't be indexed).
  invoiceNumbers: defineTable({
    companyId,
    number: v.string(),
    deliveryId: v.id("deliveries"),
  }).index("by_company_number", ["companyId", "number"]),

  deliveries: defineTable({
    companyId,
    clientId: v.id("clients"),
    clientName: v.string(),
    // Every factura number joined with ", " (used for display and search).
    invoiceNumber: v.string(),
    invoices: v.optional(
      v.array(
        v.object({
          number: v.string(),
          photoId: v.id("_storage"),
          repeat: v.optional(invoiceRepeat),
          // The latest earlier delivery with the same number, if there was one.
          previousDeliveryId: v.optional(v.id("deliveries")),
        }),
      ),
    ),
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
    // When an admin marked a "credito" delivery as paid.
    paidAt: v.optional(v.number()),
    // Reminders already sent for this delivery, as "<kind>:<channel>"
    // (e.g. "vencimiento:email"), so none is sent twice.
    reminded: v.optional(v.array(v.string())),
    status: deliveryStatus,
    // The driver's notes (optional).
    notes: v.string(),
    // What the client wrote happened, when they chose a problem. Only from
    // older app versions: now the client just picks the problem, right before
    // signing.
    clientNotes: v.optional(v.string()),
    // The client's finger-drawn signature (a trimmed transparent PNG), made on
    // a screen showing the facturas, payment and driver's notes it agrees to,
    // and confirming the status the client chose just above.
    // Saved in the same mutation as the rest, and nothing signed can be edited
    // afterwards: any future edit of those fields must remove it.
    // Required by the app; missing only on deliveries from before signatures.
    signature: v.optional(
      v.object({
        photoId: v.id("_storage"),
        signedAt: v.number(),
      }),
    ),
    driverId: v.id("users"),
    driverName: v.string(),
    // When the driver recorded it on the phone. Can be earlier than
    // _creationTime if it was saved without signal and uploaded later.
    deliveredAt: v.optional(v.number()),
    // Random id generated on the phone so a retried upload never creates the
    // same delivery twice.
    clientRequestId: v.optional(v.string()),
  })
    // These three are only read with an id that was already checked to be the
    // company's (a client or a vehicle), or to find a retried upload.
    .index("by_client", ["clientId", "deliveredAt"])
    .index("by_vehicle", ["vehicleId"])
    .index("by_client_request", ["clientRequestId"])
    .index("by_company_driver", ["companyId", "driverId", "deliveredAt"])
    .index("by_company_delivered", ["companyId", "deliveredAt"])
    .index("by_company_invoice", ["companyId", "invoiceNumber"]),

  // Log of every payment reminder sent (or that failed), shown to the admin.
  reminders: defineTable({
    companyId,
    clientId: v.id("clients"),
    kind: reminderKind,
    channel: reminderChannel,
    // Email address or WhatsApp number it was sent to.
    to: v.string(),
    // Payment deadline the message was about ("YYYY-MM-DD").
    dueDate: v.string(),
    deliveryIds: v.array(v.id("deliveries")),
    invoiceNumbers: v.array(v.string()),
    status: v.union(v.literal("enviado"), v.literal("error")),
    error: v.optional(v.string()),
  })
    .index("by_client", ["clientId"])
    .index("by_company", ["companyId"]),
});
