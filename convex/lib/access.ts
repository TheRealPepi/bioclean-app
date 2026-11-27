import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { cleanEmail } from "./text";

// Who can do what. A person has access when their Google account's email is a
// member of a company (`members` table), with one of four roles. Every public
// function starts with one of the `require…` guards below, which also say which
// company the caller belongs to; everything it then reads or writes is that
// company's (`getOwned`, and indexes that start with `companyId`).

/** The role stored for each member of a company. */
export type Role = Doc<"members">["role"];

/**
 * What app versions from before companies call the role: they only know the
 * office and the drivers. Still returned by `users.me` for them.
 */
export type LegacyRole = "admin" | "driver";

/**
 * - deliver: the phone app for registering deliveries is their home screen.
 * - office: the day-to-day work (deliveries, routes, clients, vehicles, payments).
 * - manageUsers: add and remove members.
 * - manageCompany: change the company's settings.
 */
export type Capability = "deliver" | "office" | "manageUsers" | "manageCompany";

const CAPABILITIES: Record<Role, readonly Capability[]> = {
  owner: ["office", "manageUsers", "manageCompany"],
  admin: ["office", "manageUsers", "manageCompany"],
  office: ["office"],
  driver: ["deliver"],
};

/** Nothing for someone without a role, or with one this version doesn't know. */
export function capabilitiesFor(role: Role | null | undefined): readonly Capability[] {
  return (role && CAPABILITIES[role]) ?? [];
}

export function legacyRole(role: Role | null | undefined): LegacyRole | null {
  if (!role) return null;
  return capabilitiesFor(role).includes("office") ? "admin" : "driver";
}

/** Parses a comma/space/semicolon separated env var into a set of lowercase emails. */
export function emailList(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(/[\s,;]+/)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * Whether this email may create a company: only the ones listed in the
 * COMPANY_CREATOR_EMAILS env var, so nobody signs their company up on their own.
 */
export function canCreateCompany(email: string | undefined): boolean {
  return !!email && emailList(process.env.COMPANY_CREATOR_EMAILS).has(cleanEmail(email));
}

/** The membership of an email, however it was typed. An email is in at most one company. */
export async function memberByEmail(ctx: QueryCtx, email: string | undefined) {
  if (!email) return null;
  return await ctx.db
    .query("members")
    .withIndex("by_email", (q) => q.eq("email", cleanEmail(email)))
    .first();
}

/**
 * The signed-in user and their membership, if any. Looked up on every call, so
 * removing a member (or changing their role) takes effect right away.
 */
export async function getViewer(
  ctx: QueryCtx,
): Promise<{ user: Doc<"users">; member: Doc<"members"> | null } | null> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;
  const user = await ctx.db.get(userId); // tenant-ok: the caller's own user
  if (user === null) return null;
  return { user, member: await memberByEmail(ctx, user.email) };
}

/** Any member of a company. */
export async function requireUser(ctx: QueryCtx) {
  const viewer = await getViewer(ctx);
  if (viewer === null || viewer.member === null) {
    throw new ConvexError("No tienes acceso a esta aplicación.");
  }
  const { user, member } = viewer;
  return { user, member, role: member.role, companyId: member.companyId };
}

async function requireCapability(ctx: QueryCtx, capability: Capability) {
  const viewer = await requireUser(ctx);
  if (!capabilitiesFor(viewer.role).includes(capability)) {
    throw new ConvexError("Solo el administrador puede hacer esto.");
  }
  return viewer;
}

/** The day-to-day work of the office: owner, admin and office. */
export const requireOffice = (ctx: QueryCtx) => requireCapability(ctx, "office");

/** Users and company settings: owner and admin. */
export const requireAdmin = (ctx: QueryCtx, capability: "manageUsers" | "manageCompany") =>
  requireCapability(ctx, capability);

/** The caller's company. It exists for as long as it has members. */
export async function getCompany(ctx: QueryCtx, companyId: Id<"companies">) {
  const company = await ctx.db.get(companyId); // tenant-ok: the caller's own company
  if (company === null) throw new ConvexError("No tienes acceso a esta aplicación.");
  return company;
}

type TenantTable =
  | "clients"
  | "vehicles"
  | "deliveries"
  | "routes"
  | "reminders"
  | "invoiceNumbers"
  | "members";

/**
 * The row with that id, or null when it doesn't exist or belongs to another
 * company: an id from somewhere else behaves exactly like a deleted one.
 */
export async function getOwned<Table extends TenantTable>(
  ctx: QueryCtx,
  companyId: Id<"companies">,
  id: Id<Table> | null | undefined,
): Promise<Doc<Table> | null> {
  if (!id) return null;
  const row = await ctx.db.get(id as Id<TenantTable>); // tenant-ok: checked right below
  return row !== null && row.companyId === companyId ? (row as unknown as Doc<Table>) : null;
}

export function displayName(user: Doc<"users">): string {
  return user.name?.trim() || user.email || "Sin nombre";
}
