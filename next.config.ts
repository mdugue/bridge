import type { NextConfig } from "next";
import { reportBuild, tunnelRewrites } from "./lib/city/crash-reports";

// The crash reports' build (ADR 0043): the release and environment the
// page tags its reports with, derived once — scripts/sentry-release.ts
// creates the release under the same name.
const reports = reportBuild(process.env);

const nextConfig: NextConfig = {
  cacheComponents: true,
  env: {
    CRASH_REPORTS_RELEASE: reports.release ?? "",
    CRASH_REPORTS_ENV: reports.environment,
  },
  allowedDevOrigins: ["192.168.178.130"],
  // The sites' data is served as static files and never read on the server;
  // only its index (public/data/sites.json) is, at build time. Traced, the
  // folders would ride along in every server function — seven sites are
  // ~340 MB, past a host's function size limit (Vercel: 250 MB).
  outputFileTracingExcludes: { "/**": ["public/data/*/**/*"] },
  reactCompiler: true,
  reactStrictMode: true,
  // Everything under /data/<site>/ is published under a content-hashed name
  // by scripts/prepare-data.ts, so it can be cached forever; each site's
  // manifest (logical → hashed names) and the index of sites
  // (prepare-sites.ts) are the files that must always revalidate.
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
        source: "/data/:site/manifest.json",
        headers: [{ key: "Cache-Control", value: "public, no-cache" }],
      },
      {
        source: "/data/sites.json",
        headers: [{ key: "Cache-Control", value: "public, no-cache" }],
      },
    ]),
  // The reports go to the site's own origin and on from here to the
  // tracker (none without a DSN): a blocker that drops requests to the
  // tracker's host lets them through.
  rewrites: () => Promise.resolve(tunnelRewrites(reports.dsn)),
  redirects: () =>
    Promise.resolve([
      // The viewer lived at /city, then at the root route; the root is the
      // start page now and every city has its own route (/dresden).
      { source: "/city", destination: "/dresden", permanent: false },
    ]),
};

export default nextConfig;
