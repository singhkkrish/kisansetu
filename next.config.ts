import type { NextConfig } from "next";

// Every screen in KisanSetu depends on the signed-in user's session, so pages
// render per request. Cache Components (static shells with Suspense around
// runtime data) is deliberately left off.
const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
