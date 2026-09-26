import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // The site this build renders (sites/index.ts): SITE from .env.local, or
  // the host's environment in a deployment. The fetch/bake scripts and
  // prepare-data read the same SITE, so the data and the HUD always
  // describe one place.
  env: { NEXT_PUBLIC_SITE: process.env.SITE ?? "dresden" },
  reactCompiler: true,
  reactStrictMode: true,
  // Everything under /data is published under a content-hashed name by
  // scripts/prepare-data.ts, so it can be cached forever; the manifest that
  // maps logical → hashed names is the one file that must always revalidate.
  // (Next's default for public/ is max-age=0, i.e. one revalidation round
  // trip per file per visit — 60 of them here.)
  headers: () =>
    Promise.resolve([
      {
        source: "/data/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/data/manifest.json",
        headers: [{ key: "Cache-Control", value: "public, no-cache" }],
      },
    ]),
  redirects: () =>
    Promise.resolve([
      // The viewer moved from /city to the root route.
      { source: "/city", destination: "/", permanent: false },
    ]),
};

export default nextConfig;
