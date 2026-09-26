import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
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
