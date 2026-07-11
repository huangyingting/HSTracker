import { cp, mkdir } from "node:fs/promises";

await mkdir(".next/standalone/.next/static", { recursive: true });
await cp(".next/static", ".next/standalone/.next/static", {
  force: true,
  recursive: true,
});
