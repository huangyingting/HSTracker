import { cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

await mkdir(".next/standalone/.next/static", { recursive: true });
await cp(".next/static", ".next/standalone/.next/static", {
  force: true,
  recursive: true,
});

const standaloneRequire = createRequire(
  resolve(".next/standalone/server.js"),
);
standaloneRequire("@duckdb/node-api");
standaloneRequire("better-sqlite3");
standaloneRequire("pg");
