import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  async headers() {
    return ["/runtime/:path*", "/community-runtime/:path*", "/images/:path*"].map((source) => ({ source, headers: [{ key: "Access-Control-Allow-Origin", value: "*" }, { key: "Cross-Origin-Resource-Policy", value: "cross-origin" }] }));
  },
  distDir: process.env.BARK_BUILD_DIR || ".next",
  // Minimal self-contained server for the production Docker image.
  output: "standalone",
  poweredByHeader: false,
  reactCompiler: true,
  transpilePackages: ["@bark/engine", "@bark/scripting"],
  outputFileTracingRoot: path.resolve(process.cwd(), '..'),
  turbopack: { root: path.resolve(process.cwd(), '..') },
};

export default nextConfig;
