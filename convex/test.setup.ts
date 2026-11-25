/// <reference types="vite/client" />
// Shared by the Convex function tests (convex/*.test.ts). Convex doesn't deploy
// files with more than one dot in their name, so none of this reaches the backend.
import { convexTest } from "convex-test";
import { vi } from "vitest";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Every function module, plus _generated (how convex-test finds this folder).
const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.*.ts"]);

export const ADMIN_EMAIL = "oficina@example.com";
export const DRIVER_EMAIL = "chofer@example.com";
export const OTHER_DRIVER_EMAIL = "chofer2@example.com";

/** A point in Cozumel, and one about 1 km north of it. */
export const HERE = { lat: 20.5, lng: -86.95 };
export const FAR = { lat: 20.51, lng: -86.95 };

/**
 * An empty backend with an admin, two drivers and a signed-in user who is on
 * neither access list. Roles come from the env vars, as in production.
 */
export async function setup() {
  vi.stubEnv("ADMIN_EMAILS", ADMIN_EMAIL);
  vi.stubEnv("ALLOWED_EMAILS", `${DRIVER_EMAIL}, ${OTHER_DRIVER_EMAIL}`);

  const t = convexTest(schema, modules);
  const user = (name: string, email: string) =>
    t.run(async (ctx) => await ctx.db.insert("users", { name, email }));
  const adminId = await user("Oficina", ADMIN_EMAIL);
  const driverId = await user("Chofer Uno", DRIVER_EMAIL);
  const otherDriverId = await user("Chofer Dos", OTHER_DRIVER_EMAIL);
  const outsiderId = await user("Extraño", "nadie@example.com");

  // Convex Auth puts "<userId>|<sessionId>" in the token's subject.
  const as = (id: Id<"users">) => t.withIdentity({ subject: `${id}|test` });

  /** A stored file, standing in for a photo taken on the phone. */
  const photo = () => t.run(async (ctx) => await ctx.storage.store(new Blob(["foto"])));

  /** Valid arguments for `deliveries.create`; each test overrides what it's about. */
  const deliveryArgs = async (overrides: Partial<DeliveryArgs> & { invoice?: string } = {}) => {
    const { invoice = "F-100", ...rest } = overrides;
    return {
      clientName: "Hotel Cozumel",
      invoices: [{ number: invoice, photoId: await photo() }],
      receiverPhotoId: await photo(),
      goodsPhotoId: await photo(),
      location: HERE,
      status: "exitosa" as const,
      notes: "",
      ...rest,
    } satisfies DeliveryArgs;
  };

  return {
    t,
    adminId,
    driverId,
    otherDriverId,
    asAdmin: as(adminId),
    asDriver: as(driverId),
    asOtherDriver: as(otherDriverId),
    asOutsider: as(outsiderId),
    photo,
    deliveryArgs,
  };
}

type DeliveryArgs = {
  clientId?: Id<"clients">;
  clientName: string;
  invoices: { number: string; photoId: Id<"_storage">; followUp?: boolean }[];
  receiverPhotoId: Id<"_storage">;
  goodsPhotoId: Id<"_storage">;
  location: { lat: number; lng: number };
  locationSource?: "guardada" | "modificada" | "nueva";
  driverPosition?: { lat: number; lng: number };
  payment?: "pagado" | "credito";
  status: "exitosa" | "faltante" | "cambio_mercancia" | "cambio_factura" | "no_recibido";
  notes: string;
  clientNotes?: string;
  deliveredAt?: number;
  clientRequestId?: string;
};
