import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type QueryCtx } from "./_generated/server";
import {
  displayName,
  getCompany,
  getOwned,
  memberByEmail,
  requireOffice,
  requireUser,
} from "./lib/access";
import { isValidPoint, type Point } from "./lib/geo";
import { MAX_ROUTE_STOPS, ROUTE_KEEP_MS, ROUTE_TTL_MS } from "./lib/routes";

/**
 * The route with, for each stop, the first delivery made to that client since
 * the route was created (by any driver): that's what marks a stop as delivered.
 * A route's stops are always clients of its own company (see `routeFields`).
 */
async function withProgress(ctx: QueryCtx, route: Doc<"routes">) {
  const stops = await Promise.all(
    route.stops.map(async (stop) => {
      const delivery = await ctx.db
        .query("deliveries")
        .withIndex("by_client", (q) =>
          q.eq("clientId", stop.clientId).gte("deliveredAt", route._creationTime),
        )
        .first();
      return {
        clientId: stop.clientId,
        clientName: stop.clientName,
        location: { lat: stop.location.lat, lng: stop.location.lng },
        customLocation: stop.customLocation ?? false,
        deliveryId: delivery?._id ?? null,
      };
    }),
  );
  return {
    _id: route._id,
    createdAt: route._creationTime,
    expiresAt: route.expiresAt,
    driverId: route.driverId,
    driverName: route.driverName,
    base: route.base ? { lat: route.base.lat, lng: route.base.lng } : null,
    returnToBase: route.returnToBase,
    stops,
  };
}

/** Every route still kept, newest first. Expired ones stay until `purgeExpired` deletes them. */
export const listAdmin = query({
  args: {},
  handler: async (ctx) => {
    const { companyId } = await requireOffice(ctx);
    const routes = await ctx.db
      .query("routes")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .order("desc")
      .collect();
    return await Promise.all(routes.map((route) => withProgress(ctx, route)));
  },
});

/**
 * The current driver's latest routes. Expired ones are included: a query can't
 * watch the clock, so the phone hides them by `expiresAt` (also without signal).
 */
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const { user, companyId } = await requireUser(ctx);
    const routes = await ctx.db
      .query("routes")
      .withIndex("by_company_driver", (q) =>
        q.eq("companyId", companyId).eq("driverId", user._id),
      )
      .order("desc")
      .take(5);
    const result = await Promise.all(routes.map((route) => withProgress(ctx, route)));
    return result.map(({ stops, ...route }) => ({
      ...route,
      stops: stops.map(({ deliveryId, ...stop }) => ({ ...stop, delivered: deliveryId !== null })),
    }));
  },
});

const routeArgs = {
  driverId: v.id("users"),
  // In visit order.
  stops: v.array(
    v.object({
      clientId: v.id("clients"),
      // Only when the office chose a location for this route; otherwise the client's saved one.
      location: v.optional(v.object({ lat: v.number(), lng: v.number() })),
    }),
  ),
  returnToBase: v.boolean(),
};

/** What the office chose in the builder, checked and with each client's name and location. */
async function routeFields(
  ctx: QueryCtx,
  companyId: Id<"companies">,
  args: {
    driverId: Id<"users">;
    stops: { clientId: Id<"clients">; location?: Point }[];
    returnToBase: boolean;
  },
) {
  const { driverId, returnToBase } = args;
  const clientIds = args.stops.map((s) => s.clientId);

  // tenant-ok: only used if this user is a member of the caller's company.
  const driver = await ctx.db.get(driverId);
  const membership = await memberByEmail(ctx, driver?.email);
  if (!driver || membership?.companyId !== companyId) {
    throw new ConvexError("Ese chofer ya no tiene acceso a la app. Elige otro.");
  }
  if (clientIds.length === 0) throw new ConvexError("Elige al menos un cliente.");
  if (clientIds.length > MAX_ROUTE_STOPS) {
    throw new ConvexError(`Una ruta puede tener hasta ${MAX_ROUTE_STOPS} paradas.`);
  }
  if (new Set(clientIds).size !== clientIds.length) {
    throw new ConvexError("Hay un cliente repetido en la ruta.");
  }

  const stops: Doc<"routes">["stops"] = [];
  for (const { clientId, location: custom } of args.stops) {
    const client = await getOwned(ctx, companyId, clientId);
    if (!client) throw new ConvexError("Uno de los clientes ya no existe. Vuelve a elegirlos.");
    if (custom) {
      if (!isValidPoint(custom)) {
        throw new ConvexError(`La ubicación de ${client.name} no es válida.`);
      }
      stops.push({ clientId, clientName: client.name, location: custom, customLocation: true });
    } else if (client.location) {
      stops.push({ clientId, clientName: client.name, location: client.location });
    } else {
      throw new ConvexError(`${client.name} no tiene ubicación. Dale una para esta ruta.`);
    }
  }

  const company = await getCompany(ctx, companyId);
  return {
    companyId,
    driverId,
    driverName: displayName(driver),
    stops,
    base: company.base,
    returnToBase,
  };
}

export const create = mutation({
  args: routeArgs,
  handler: async (ctx, args) => {
    const { companyId } = await requireOffice(ctx);
    return await ctx.db.insert("routes", {
      ...(await routeFields(ctx, companyId, args)),
      expiresAt: Date.now() + ROUTE_TTL_MS,
    });
  },
});

/**
 * Changes a route the driver still sees. It stays the same route: it expires
 * when it was going to, and the stops already delivered still count (they're
 * measured from when the route was created).
 */
export const update = mutation({
  args: { routeId: v.id("routes"), ...routeArgs },
  handler: async (ctx, { routeId, ...args }) => {
    const { companyId } = await requireOffice(ctx);
    const route = await getOwned(ctx, companyId, routeId);
    if (!route) throw new ConvexError("Esa ruta ya no existe.");
    if (route.expiresAt <= Date.now()) {
      throw new ConvexError("Esa ruta ya venció. Crea una nueva con «Usar de nuevo».");
    }
    // `replace`, not `patch`: a base that was removed has to go from the route too.
    await ctx.db.replace(routeId, {
      ...(await routeFields(ctx, companyId, args)),
      expiresAt: route.expiresAt,
    });
    return routeId;
  },
});

export const remove = mutation({
  args: { routeId: v.id("routes") },
  handler: async (ctx, { routeId }) => {
    const { companyId } = await requireOffice(ctx);
    if (await getOwned(ctx, companyId, routeId)) await ctx.db.delete(routeId);
  },
});

/** Daily (see `crons.ts`): deletes every company's routes that expired more than `ROUTE_KEEP_MS` ago. */
export const purgeExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const old = await ctx.db
      .query("routes")
      .withIndex("by_expires", (q) => q.lt("expiresAt", Date.now() - ROUTE_KEEP_MS))
      .collect();
    for (const route of old) await ctx.db.delete(route._id);
    return { deleted: old.length };
  },
});
