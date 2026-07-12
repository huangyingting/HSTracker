import { getApplicationRuntime } from "../../runtime/application-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  const buildId = process.env.APP_BUILD_ID?.trim() || "development";

  return Response.json(
    getApplicationRuntime().health(buildId),
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
