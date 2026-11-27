import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalMutation, mutation, query, type QueryCtx } from "./_generated/server";
import { displayName, getOwned, memberByEmail, requireAdmin, type Role } from "./lib/access";
import { cleanEmail, isEmail } from "./lib/text";
import { memberRole } from "./schema";

// The users of a company. Adding one authorizes an email: that person gets
// access the first time they sign in with that Google account, and shows as
// pending until then. An email belongs to one company only.

/** The account that signed in with this (already cleaned) email, if any. */
export const userByEmail = (ctx: QueryCtx, email: string) =>
  ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", email))
    .first();

const ROLE_ORDER: Role[] = ["owner", "admin", "office", "driver"];

export const list = query({
  args: {},
  handler: async (ctx) => {
    const { member: me, companyId } = await requireAdmin(ctx, "manageUsers");
    const members = await ctx.db
      .query("members")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .collect();
    const rows = await Promise.all(
      members.map(async (member) => {
        const user = await userByEmail(ctx, member.email);
        return {
          _id: member._id,
          email: member.email,
          role: member.role,
          // Null until they sign in for the first time.
          name: user ? displayName(user) : null,
          image: user?.image ?? null,
          isMe: member._id === me._id,
        };
      }),
    );
    return rows.sort(
      (a, b) =>
        ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) ||
        a.email.localeCompare(b.email, "es"),
    );
  },
});

/** The owner is whoever created the company: the role can't be given from the app. */
function assignable(role: Role) {
  if (role === "owner") throw new ConvexError("Una empresa solo tiene un dueño.");
  return role;
}

export const add = mutation({
  args: { email: v.string(), role: memberRole },
  handler: async (ctx, args) => {
    const { user, companyId } = await requireAdmin(ctx, "manageUsers");
    const role = assignable(args.role);
    const email = cleanEmail(args.email);
    if (!isEmail(email)) throw new ConvexError("El correo no es válido.");

    const existing = await memberByEmail(ctx, email);
    if (existing) {
      throw new ConvexError(
        existing.companyId === companyId
          ? "Ese correo ya es usuario de tu empresa."
          : "Ese correo ya pertenece a otra empresa.",
      );
    }
    return await ctx.db.insert("members", { companyId, email, role, addedBy: user._id });
  },
});

/** The member to change: one of this company, who isn't the owner or the caller. */
async function editableMember(
  ctx: QueryCtx,
  viewer: { member: { _id: Id<"members"> }; companyId: Id<"companies"> },
  memberId: Id<"members">,
) {
  const member = await getOwned(ctx, viewer.companyId, memberId);
  if (!member) throw new ConvexError("Ese usuario ya no existe.");
  if (member.role === "owner") {
    throw new ConvexError("El dueño de la empresa no se puede cambiar ni quitar.");
  }
  if (member._id === viewer.member._id) {
    throw new ConvexError("No puedes cambiar tu propio acceso. Pídeselo a otro administrador.");
  }
  return member;
}

export const setRole = mutation({
  args: { memberId: v.id("members"), role: memberRole },
  handler: async (ctx, args) => {
    const viewer = await requireAdmin(ctx, "manageUsers");
    const role = assignable(args.role);
    const member = await editableMember(ctx, viewer, args.memberId);
    await ctx.db.patch(member._id, { role });
  },
});

/** Takes access away right away. What the person registered stays in the company. */
export const remove = mutation({
  args: { memberId: v.id("members") },
  handler: async (ctx, args) => {
    const viewer = await requireAdmin(ctx, "manageUsers");
    const member = await editableMember(ctx, viewer, args.memberId);
    await ctx.db.delete(member._id);
  },
});

/**
 * For whoever runs the deployment, when a company's owner changes:
 * `npx convex run members:transferOwnership '{"companyId": "…", "email": "…"}'`.
 * The new owner has to be a user of the company already; the old one stays as admin.
 */
export const transferOwnership = internalMutation({
  args: { companyId: v.id("companies"), email: v.string() },
  handler: async (ctx, args) => {
    const members = await ctx.db
      .query("members")
      .withIndex("by_company", (q) => q.eq("companyId", args.companyId))
      .collect();
    const email = cleanEmail(args.email);
    const next = members.find((m) => m.email === email);
    if (!next) throw new Error(`${email} no es usuario de esa empresa.`);
    for (const member of members) {
      if (member.role === "owner" && member._id !== next._id) {
        await ctx.db.patch(member._id, { role: "admin" });
      }
    }
    await ctx.db.patch(next._id, { role: "owner" });
    return { owner: email };
  },
});
