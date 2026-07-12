import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/",
        headers: [
          {
            key: "Cache-Control",
            value: "public, no-cache",
          },
        ],
      },
    ];
  },
  output: "standalone",
  outputFileTracingIncludes: {
    "/*": ["./node_modules/@duckdb/node-bindings-*/libduckdb.*"],
  },
  poweredByHeader: false,
  serverExternalPackages: ["@duckdb/node-api"],
};

export default nextConfig;
