import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { Role } from "../../convex/lib/access";
import { LEGACY_TIME_ZONE } from "../../convex/lib/dates";

type MeResult = NonNullable<FunctionReturnType<typeof api.users.me>>;

/** The signed-in user once we know they belong to a company. */
export type Me = Pick<MeResult, "_id" | "name" | "email" | "image" | "can"> & {
  memberRole: Role;
  company: NonNullable<MeResult["company"]>;
};

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Dueño",
  admin: "Administrador",
  office: "Oficina",
  driver: "Chofer",
};

/** What each role can do, as the users page explains it. */
export const ROLE_HELP: Record<Role, string> = {
  owner: "Creó la empresa. Puede hacer todo y no se puede quitar.",
  admin: "Todo: entregas, rutas, clientes, usuarios y configuración.",
  office: "El trabajo diario: entregas, rutas, clientes, vehículos y pagos.",
  driver: "Registra entregas desde su teléfono y ve sus rutas.",
};

/** The member `users.me` describes, or null for someone who isn't in a company. */
export function memberFrom(result: MeResult | null | undefined): Me | null {
  // Also missing altogether, in a profile stored by an older version of the app.
  if (!result || !result.memberRole || !result.company) return null;
  const { _id, name, email, image, can, memberRole, company } = result;
  return { _id, name, email, image, can, memberRole, company };
}

/**
 * The driver profile stored on this phone, used to open the app without
 * signal. One stored by an app version from before companies only says
 * `role: "driver"`: it's completed with what was true then, so a driver who
 * updates the app while offline keeps working. The next answer from the
 * server replaces it.
 */
export function upgradeCachedMe(cached: unknown): Me | null {
  if (typeof cached !== "object" || cached === null) return null;
  const stored = cached as Partial<MeResult>;
  if (typeof stored._id !== "string" || typeof stored.name !== "string") return null;
  const current = memberFrom(stored as MeResult);
  if (current) return current;
  if (stored.role !== "driver") return null;
  return {
    _id: stored._id,
    name: stored.name,
    email: stored.email ?? null,
    image: stored.image ?? null,
    can: ["deliver"],
    memberRole: "driver",
    company: {
      // Not known yet. Nothing sends it to the server.
      _id: "" as Id<"companies">,
      name: "",
      timeZone: LEGACY_TIME_ZONE,
      phoneCountryCode: "52",
      serviceArea: null,
    },
  };
}
