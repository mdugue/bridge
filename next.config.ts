import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  reactCompiler: true,
  reactStrictMode: true,
  // cityjson-threejs-loader ships untranspiled ESM; Next won't build it raw.
  transpilePackages: ["cityjson-threejs-loader"],
  redirects: () =>
    Promise.resolve([
      // The viewer moved from /city to the root route.
      { source: "/city", destination: "/", permanent: false },
    ]),
};

export default nextConfig;
