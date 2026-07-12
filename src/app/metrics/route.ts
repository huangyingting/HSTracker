import { runtimeMetricRegistry } from "../../operations/runtime-prometheus-metrics";

export const dynamic = "force-dynamic";

export function GET(): Response {
  return new Response(runtimeMetricRegistry().render(), {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
    },
  });
}
