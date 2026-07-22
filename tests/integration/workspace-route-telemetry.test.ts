import { describe, expect, it } from "vitest";

import { POST } from "../../src/app/api/telemetry/workspace-route/route";
import { GET as getMetrics } from "../../src/app/metrics/route";

describe("workspace route telemetry", () => {
  it("records only the anonymous route family in runtime metrics", async () => {
    const response = await POST(
      new Request("http://localhost/api/telemetry/workspace-route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routeFamily: "primary-scope" }),
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Cache-Control")).toBe("no-store");

    const metrics = await (await getMetrics()).text();
    expect(metrics).toContain(
      'hs_tracker_workspace_route_views_total{route_family="primary-scope"} 1',
    );
  });

  it("rejects telemetry carrying analytical identifiers", async () => {
    const response = await POST(
      new Request("http://localhost/api/telemetry/workspace-route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          routeFamily: "primary-market-analysis",
          productCode: "010121",
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_WORKSPACE_ROUTE_TELEMETRY" },
    });
  });
});
