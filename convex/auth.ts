import Google from "@auth/core/providers/google";
import { convexAuth } from "@convex-dev/auth/server";

// Anyone can complete Google sign-in, but every query and mutation checks that
// the email is a member of a company (see lib/access.ts). This lets the app
// show a clear "no access" screen instead of silently bouncing the user.
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Google],
});
