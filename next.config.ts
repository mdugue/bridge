import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  reactCompiler: true,
  reactStrictMode: true,
  // cityjson-threejs-loader ships untranspiled ESM; Next won't build it raw.
  transpilePackages: ["cityjson-threejs-loader"],
};

export default nextConfig;
