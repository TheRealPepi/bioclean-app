/// <reference types="vite/client" />
// Shared by the Convex function tests (convex/*.test.ts). Convex doesn't deploy
// files with more than one dot in their name, so none of this reaches the backend.
import { convexTest } from "convex-test";
import { vi } from "vitest";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";

// Every function module, plus _generated (how convex-test finds this folder).
const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.*.ts"]);

export const OWNER_EMAIL = "duena@example.com";
export const ADMIN_EMAIL = "oficina@example.com";
export const OFFICE_EMAIL = "auxiliar@example.com";
export const DRIVER_EMAIL = "chofer@example.com";
export const OTHER_DRIVER_EMAIL = "chofer2@example.com";
/** Signed in, in no company, and allowed to create one. */
export const CREATOR_EMAIL = "nueva-empresa@example.com";
/** Signed in, in no company, and not allowed to create one. */
export const OUTSIDER_EMAIL = "nadie@example.com";
export const RIVAL_ADMIN_EMAIL = "oficina@rival.example";
export const RIVAL_DRIVER_EMAIL = "chofer@rival.example";

/** A point in Cozumel, and one about 1 km north of it. */
export const HERE = { lat: 20.5, lng: -86.95 };
export const FAR = { lat: 20.51, lng: -86.95 };

/**
 * An empty backend with two companies. The tests are about the first one, which
 * has an owner, an admin, someone from the office and two drivers; the second
 * one (in another time zone) is there so they can check nothing crosses over.
 * Two more people are signed in without being in any company.
 */
export async function setup() {
  vi.stubEnv("COMPANY_CREATOR_EMAILS", CREATOR_EMAIL);

  const t = convexTest(schema, modules);
  const company = (name: string, timeZone: string) =>
    t.run(
      async (ctx) => await ctx.db.insert("companies", { name, timeZone, phoneCountryCode: "52" }),
    );
  const companyId = await company("Bioclean Green Cozumel", "America/Cancun");
  const otherCompanyId = await company("Limpieza Rival", "America/Tijuana");

  /** Someone who has signed in, as a member of a company unless `member` is left out. */
  const person = (
    name: string,
    email: string,
    member?: { companyId: Id<"companies">; role: Doc<"members">["role"] },
  ) =>
    t.run(async (ctx) => {
      if (member) await ctx.db.insert("members", { ...member, email });
      return await ctx.db.insert("users", { name, email });
    });
  const ownerId = await person("Dueña", OWNER_EMAIL, { companyId, role: "owner" });
  const adminId = await person("Oficina", ADMIN_EMAIL, { companyId, role: "admin" });
  const officeId = await person("Auxiliar", OFFICE_EMAIL, { companyId, role: "office" });
  const driverId = await person("Chofer Uno", DRIVER_EMAIL, { companyId, role: "driver" });
  const otherDriverId = await person("Chofer Dos", OTHER_DRIVER_EMAIL, { companyId, role: "driver" });
  const rival = { companyId: otherCompanyId };
  const rivalAdminId = await person("Oficina Rival", RIVAL_ADMIN_EMAIL, { ...rival, role: "owner" });
  const rivalDriverId = await person("Chofer Rival", RIVAL_DRIVER_EMAIL, { ...rival, role: "driver" });
  const creatorId = await person("Emprendedora", CREATOR_EMAIL);
  const outsiderId = await person("Extraño", OUTSIDER_EMAIL);

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
    companyId,
    otherCompanyId,
    adminId,
    driverId,
    otherDriverId,
    rivalDriverId,
    asOwner: as(ownerId),
    asAdmin: as(adminId),
    asOffice: as(officeId),
    asDriver: as(driverId),
    asOtherDriver: as(otherDriverId),
    asRivalAdmin: as(rivalAdminId),
    asRivalDriver: as(rivalDriverId),
    asCreator: as(creatorId),
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
  vehicleId?: Id<"vehicles">;
  payment?: "pagado" | "credito";
  status: "exitosa" | "faltante" | "cambio_mercancia" | "cambio_factura" | "no_recibido";
  notes: string;
  clientNotes?: string;
  deliveredAt?: number;
  clientRequestId?: string;
};
