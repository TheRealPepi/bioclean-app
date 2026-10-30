import { query } from "./_generated/server";
import {
  displayName,
  emailList,
  getViewer,
  requireAdmin,
  roleForEmail,
} from "./lib/access";

export const me = query({
  args: {},
  handler: async (ctx) => {
    const viewer = await getViewer(ctx);
    if (viewer === null) return null;
    return {
      _id: viewer.user._id,
      name: displayName(viewer.user),
      email: viewer.user.email ?? null,
      image: viewer.user.image ?? null,
      role: viewer.role,
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
