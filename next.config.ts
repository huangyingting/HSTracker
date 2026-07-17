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
    "/*": [
      "./node_modules/@duckdb/node-bindings-*/libduckdb.*",
      "./node_modules/better-sqlite3/build/Release/better_sqlite3.node",
    ],
  },
  poweredByHeader: false,
  serverExternalPackages: ["@duckdb/node-api", "better-sqlite3", "pg"],
};

export default nextConfig;
