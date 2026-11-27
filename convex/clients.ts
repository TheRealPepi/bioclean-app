import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { getCompany, getOwned, requireOffice, requireUser } from "./lib/access";
import { isValidPoint } from "./lib/geo";
import { cleanEmail, cleanName, cleanPhone, isEmail, isPhone, normalizeKey } from "./lib/text";
import { notifyChannel } from "./schema";

const companyClients = (ctx: QueryCtx, companyId: Id<"companies">) =>
  ctx.db
    .query("clients")
    .withIndex("by_company_normalized", (q) => q.eq("companyId", companyId))
    .collect();

export const list = query({
  args: {},
  handler: async (ctx) => {
    const { companyId } = await requireUser(ctx);
    const clients = await companyClients(ctx, companyId);
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

/**
 * The office's client list, with the payment reminder settings. Kept apart from
 * `list` because drivers store that one on their phones.
 */
export const listAdmin = query({
  args: {},
  handler: async (ctx) => {
    const { companyId } = await requireOffice(ctx);
    const clients = await companyClients(ctx, companyId);
    return clients
      .map((c) => ({
        _id: c._id,
        name: c.name,
        deliveryCount: c.deliveryCount,
        lastDeliveryAt: c.lastDeliveryAt ?? null,
        location: c.location ?? null,
        email: c.email ?? null,
        whatsapp: c.whatsapp ?? null,
        creditDays: c.creditDays ?? null,
        notifyBy: c.notifyBy ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  },
});

/**
 * Returns the company's client matching `name` (ignoring accents/punctuation),
 * creating it if needed.
 */
export async function findOrCreateClient(
  ctx: MutationCtx,
  companyId: Id<"companies">,
  name: string,
) {
  const clean = cleanName(name);
  const key = normalizeKey(clean);
  if (!key) throw new ConvexError("Escribe el nombre del cliente.");
  const existing = await ctx.db
    .query("clients")
    .withIndex("by_company_normalized", (q) =>
      q.eq("companyId", companyId).eq("normalizedName", key),
    )
    .first();
  if (existing) return existing;
  const id = await ctx.db.insert("clients", {
    companyId,
    name: clean,
    normalizedName: key,
    deliveryCount: 0,
  });
  return (await getOwned(ctx, companyId, id))!;
}

/** `fromId` is a client already known to be the caller's company's. */
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
    const { companyId } = await requireOffice(ctx);
    const client = await getOwned(ctx, companyId, clientId);
    if (!client) throw new ConvexError("El cliente ya no existe.");

    const clean = cleanName(name);
    const key = normalizeKey(clean);
    if (!key) throw new ConvexError("El nombre no puede estar vacío.");

    const clash = await ctx.db
      .query("clients")
      .withIndex("by_company_normalized", (q) =>
        q.eq("companyId", companyId).eq("normalizedName", key),
      )
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

/** Contact data, credit days and channel for the payment reminders. */
export const updateBilling = mutation({
  args: {
    clientId: v.id("clients"),
    email: v.string(),
    whatsapp: v.string(),
    creditDays: v.union(v.number(), v.null()),
    notifyBy: v.union(notifyChannel, v.null()),
  },
  handler: async (ctx, args) => {
    const { companyId } = await requireOffice(ctx);
    const client = await getOwned(ctx, companyId, args.clientId);
    if (!client) throw new ConvexError("El cliente ya no existe.");
    const { phoneCountryCode } = await getCompany(ctx, companyId);

    const email = cleanEmail(args.email);
    if (email && !isEmail(email)) throw new ConvexError("El correo no es válido.");

    const whatsapp = cleanPhone(args.whatsapp, phoneCountryCode);
    if (whatsapp && !isPhone(whatsapp)) {
      throw new ConvexError(
        `El número de WhatsApp no es válido. Escríbelo con clave de país, por ejemplo +${phoneCountryCode} 987 123 4567.`,
      );
    }

    const { creditDays, notifyBy } = args;
    if (creditDays !== null && (!Number.isInteger(creditDays) || creditDays < 1 || creditDays > 365)) {
      throw new ConvexError("Los días de crédito deben ser un número entre 1 y 365.");
    }

    if (notifyBy !== null) {
      if (notifyBy !== "whatsapp" && !email) {
        throw new ConvexError("Escribe el correo del cliente para avisarle por correo.");
      }
      if (notifyBy !== "email" && !whatsapp) {
        throw new ConvexError("Escribe el WhatsApp del cliente para avisarle por WhatsApp.");
      }
      if (creditDays === null) {
        throw new ConvexError("Escribe los días de crédito para saber cuándo vence cada entrega.");
      }
    }

    await ctx.db.patch(args.clientId, {
      email: email || undefined,
      whatsapp: whatsapp || undefined,
      creditDays: creditDays ?? undefined,
      notifyBy: notifyBy ?? undefined,
    });
  },
});

/** Moves every delivery of `fromId` to `intoId` and deletes `fromId`. */
export const merge = mutation({
  args: { fromId: v.id("clients"), intoId: v.id("clients") },
  handler: async (ctx, { fromId, intoId }) => {
    const { companyId } = await requireOffice(ctx);
    if (fromId === intoId) throw new ConvexError("Elige un cliente distinto.");
    const from = await getOwned(ctx, companyId, fromId);
    const into = await getOwned(ctx, companyId, intoId);
    if (!from || !into) throw new ConvexError("El cliente ya no existe.");

    await setDeliveriesClient(ctx, fromId, intoId, into.name);
    await ctx.db.patch(intoId, {
      deliveryCount: into.deliveryCount + from.deliveryCount,
      lastDeliveryAt: Math.max(into.lastDeliveryAt ?? 0, from.lastDeliveryAt ?? 0) || undefined,
      location: into.location ?? from.location,
      email: into.email ?? from.email,
      whatsapp: into.whatsapp ?? from.whatsapp,
      creditDays: into.creditDays ?? from.creditDays,
      notifyBy: into.notifyBy ?? from.notifyBy,
    });
    const reminders = await ctx.db
      .query("reminders")
      .withIndex("by_client", (q) => q.eq("clientId", fromId))
      .collect();
    for (const reminder of reminders) {
      await ctx.db.patch(reminder._id, { clientId: intoId });
    }
    // Routes keep the stop where it was, now for the surviving client (or drop
    // it if that client was already a stop).
    const routes = await ctx.db
      .query("routes")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .collect();
    for (const route of routes) {
      if (!route.stops.some((s) => s.clientId === fromId)) continue;
      const hasInto = route.stops.some((s) => s.clientId === intoId);
      await ctx.db.patch(route._id, {
        stops: hasInto
          ? route.stops.filter((s) => s.clientId !== fromId)
          : route.stops.map((s) =>
              s.clientId === fromId ? { ...s, clientId: intoId, clientName: into.name } : s,
            ),
      });
    }
    await ctx.db.delete(fromId);
  },
});

/** For a client who moved: the next delivery records a new saved location. */
export const clearLocation = mutation({
  args: { clientId: v.id("clients") },
  handler: async (ctx, { clientId }) => {
    const { companyId } = await requireOffice(ctx);
    const client = await getOwned(ctx, companyId, clientId);
    if (!client) throw new ConvexError("El cliente ya no existe.");
    await ctx.db.patch(clientId, { location: undefined });
  },
});

/** The office sets the client's saved location (from the route builder). */
export const setLocation = mutation({
  args: {
    clientId: v.id("clients"),
    location: v.object({ lat: v.number(), lng: v.number() }),
  },
  handler: async (ctx, { clientId, location }) => {
    const { companyId } = await requireOffice(ctx);
    const client = await getOwned(ctx, companyId, clientId);
    if (!client) throw new ConvexError("El cliente ya no existe.");
    if (!isValidPoint(location)) throw new ConvexError("La ubicación no es válida.");
    await ctx.db.patch(clientId, { location });
  },
});
