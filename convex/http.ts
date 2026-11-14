import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";
import { EMAIL_LOGO_PATH, emailLogoBytes } from "./lib/emailLogo";

const http = httpRouter();

auth.addHttpRoutes(http);

// The logo of the payment reminder emails (convex/lib/reminderEmail.ts).
http.route({
  path: EMAIL_LOGO_PATH,
  method: "GET",
  handler: httpAction(
    async () =>
      new Response(emailLogoBytes(), {
        headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" },
      }),
  ),
});

export default http;
