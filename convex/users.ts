import { query } from "./_generated/server";
import {
  canCreateCompany,
  capabilitiesFor,
  displayName,
  getCompany,
  getViewer,
  legacyRole,
  requireOffice,
} from "./lib/access";
import { userByEmail } from "./members";

/**
 * The signed-in user, their role and their company. Someone who isn't a member
 * of any company gets null in those: the app shows them the "no access" screen,
 * or the form to create a company if `canCreateCompany`.
 */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getViewer(ctx);
    if (viewer === null) return null;
    const { user, member } = viewer;
    const company = member && (await getCompany(ctx, member.companyId));

    return {
      _id: user._id,
      name: displayName(user),
      email: user.email ?? null,
      image: user.image ?? null,
      // "admin" or "driver": all that app versions from before companies know.
      role: legacyRole(member?.role),
      memberRole: member?.role ?? null,
      can: capabilitiesFor(member?.role),
      company: company && {
        _id: company._id,
        name: company.name,
        timeZone: company.timeZone,
        phoneCountryCode: company.phoneCountryCode,
        serviceArea: company.serviceArea ?? null,
      },
      canCreateCompany: member === null && canCreateCompany(user.email),
    };
  },
});

/**
 * Everyone in the company who registers deliveries (the drivers, plus anyone
 * from the office who has delivered), and the drivers who were given access
 * but have never signed in.
 */
export const listDrivers = query({
  args: {},
  handler: async (ctx) => {
    const { companyId } = await requireOffice(ctx);
    const members = await ctx.db
      .query("members")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .collect();

    const drivers = [];
    const pendingEmails = [];
    for (const member of members) {
      const user = await userByEmail(ctx, member.email);
      if (!user) {
        if (member.role === "driver") pendingEmails.push(member.email);
        continue;
      }
      const deliveries = await ctx.db
        .query("deliveries")
        .withIndex("by_company_driver", (q) =>
          q.eq("companyId", companyId).eq("driverId", user._id),
        )
        .order("desc")
        .collect();
      if (member.role !== "driver" && deliveries.length === 0) continue;
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
    pendingEmails.sort();

    return { drivers, pendingEmails };
  },
});
