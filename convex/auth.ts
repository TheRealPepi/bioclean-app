import Google from "@auth/core/providers/google";
import { convexAuth } from "@convex-dev/auth/server";

// Anyone can complete Google sign-in, but every query and mutation checks the
// email against ALLOWED_EMAILS / ADMIN_EMAILS (see lib/access.ts). This lets the
// app show a clear "no access" screen instead of silently bouncing the user.
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Google],
});
