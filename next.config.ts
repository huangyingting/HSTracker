import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: {
    "/*": ["./node_modules/@duckdb/node-bindings-*/libduckdb.*"],
  },
  poweredByHeader: false,
  serverExternalPackages: ["@duckdb/node-api"],
};

export default nextConfig;
