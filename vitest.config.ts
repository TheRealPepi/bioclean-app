import { defineConfig } from "vitest/config";

// Separate from vite.config.ts on purpose: tests don't need the React or PWA
// plugins. Files that test Convex functions (convex/*.test.ts) switch to the
// edge runtime themselves with a `@vitest-environment edge-runtime` comment.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "convex/**/*.test.ts"],
    server: { deps: { inline: ["convex-test"] } },
    unstubEnvs: true,
    unstubGlobals: true,
  },
});
