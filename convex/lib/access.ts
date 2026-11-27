import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

export type Role = "admin" | "driver";

/** The role stored for each member of a company (`members` table). */
export type MemberRole = Doc<"members">["role"];

/**
 * - deliver: register deliveries from the phone.
 * - office: the day-to-day work (deliveries, routes, clients, vehicles, payments).
 * - manageUsers: add and remove members.
 * - manageCompany: change the company's settings.
 */
export type Capability = "deliver" | "office" | "manageUsers" | "manageCompany";

const CAPABILITIES: Record<MemberRole, readonly Capability[]> = {
  owner: ["office", "manageUsers", "manageCompany"],
  admin: ["office", "manageUsers", "manageCompany"],
  office: ["office"],
  driver: ["deliver"],
};

/** Nothing for someone without a role, or with one this version doesn't know. */
export function capabilitiesFor(role: MemberRole | null | undefined): readonly Capability[] {
  return (role && CAPABILITIES[role]) ?? [];
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
 * Roles come from Convex env vars on every call, so removing an email from
 * ALLOWED_EMAILS / ADMIN_EMAILS revokes access immediately.
 */
export function roleForEmail(email: string | undefined): Role | null {
  if (!email) return null;
  const normalized = email.toLowerCase();
  if (emailList(process.env.ADMIN_EMAILS).has(normalized)) return "admin";
  if (emailList(process.env.ALLOWED_EMAILS).has(normalized)) return "driver";
  return null;
}

export async function getViewer(
  ctx: QueryCtx,
): Promise<{ user: Doc<"users">; role: Role | null } | null> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;
  const user = await ctx.db.get(userId);
  if (user === null) return null;
  return { user, role: roleForEmail(user.email) };
}

export async function requireUser(ctx: QueryCtx) {
  const viewer = await getViewer(ctx);
  if (viewer === null || viewer.role === null) {
    throw new ConvexError("No tienes acceso a esta aplicación.");
  }
  return { user: viewer.user, role: viewer.role };
}

export async function requireAdmin(ctx: QueryCtx) {
  const viewer = await requireUser(ctx);
  if (viewer.role !== "admin") {
    throw new ConvexError("Solo el administrador puede hacer esto.");
  }
  return viewer;
}

export function displayName(user: Doc<"users">): string {
  return user.name?.trim() || user.email || "Sin nombre";
}
