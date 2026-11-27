import { query } from "./_generated/server";
import {
  capabilitiesFor,
  displayName,
  emailList,
  getViewer,
  requireAdmin,
  roleForEmail,
} from "./lib/access";
import { cleanEmail } from "./lib/text";

export const me = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getViewer(ctx);
    if (viewer === null) return null;

    // Not used to grant access yet (`role` still comes from the env vars):
    // returned so phones already have it stored when it is.
    const email = viewer.user.email;
    const member = email
      ? await ctx.db
          .query("members")
          .withIndex("by_email", (q) => q.eq("email", cleanEmail(email)))
          .first()
      : null;
    const company = member ? await ctx.db.get(member.companyId) : null;

    return {
      _id: viewer.user._id,
      name: displayName(viewer.user),
      email: viewer.user.email ?? null,
      image: viewer.user.image ?? null,
      role: viewer.role,
      memberRole: member?.role ?? null,
      can: capabilitiesFor(member?.role),
      company: company && {
        _id: company._id,
        name: company.name,
        timeZone: company.timeZone,
        phoneCountryCode: company.phoneCountryCode,
        serviceArea: company.serviceArea ?? null,
      },
    };
  },
});

/**
 * Everyone who can register deliveries (drivers, plus any admin who has
 * delivered), and emails in ALLOWED_EMAILS that have never signed in.
 */
export const listDrivers = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const users = await ctx.db.query("users").collect();

    const drivers = [];
    for (const user of users) {
      const role = roleForEmail(user.email);
      if (role === null) continue;
      const deliveries = await ctx.db
        .query("deliveries")
        .withIndex("by_driver", (q) => q.eq("driverId", user._id))
        .order("desc")
        .collect();
      if (role === "admin" && deliveries.length === 0) continue;
      drivers.push({
        _id: user._id,
        name: displayName(user),
        email: user.email ?? null,
        image: user.image ?? null,
        deliveryCount: deliveries.length,
        lastDeliveryAt: deliveries[0] ? (deliveries[0].deliveredAt ?? deliveries[0]._creationTime) : null,
      });
    }
    drivers.sort((a, b) => a.name.localeCompare(b.name, "es"));

    const signedIn = new Set(users.map((u) => u.email?.toLowerCase()));
    const pendingEmails = [...emailList(process.env.ALLOWED_EMAILS)]
      .filter((email) => !signedIn.has(email))
      .sort();

    return { drivers, pendingEmails };
  },
});
