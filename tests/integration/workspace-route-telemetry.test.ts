import { describe, expect, it } from "vitest";

import { POST } from "../../src/app/api/telemetry/workspace-route/route";
import { GET as getMetrics } from "../../src/app/metrics/route";
import { parseTradeAnalysisContext } from "../../src/app/trade-analysis-context";
import { workspaceRouteFamily } from "../../src/app/workspace-route-family";

describe("workspace route telemetry", () => {
  it("classifies primary stages only from complete semantic scope", () => {
    expect(
      workspaceRouteFamily(
        parseTradeAnalysisContext(
          "/?recipe=candidate-market-v1&revision=HS12&product=010121&market=528",
        ),
      ),
    ).toBe("primary-scope");
    expect(
      workspaceRouteFamily(
        parseTradeAnalysisContext(
          "/?recipe=candidate-market-v1&exporter=156&revision=HS12&product=010121",
        ),
      ),
    ).toBe("primary-opportunities");
    expect(
      workspaceRouteFamily(
        parseTradeAnalysisContext(
          "/?recipe=candidate-market-v1&exporter=156&revision=HS12&product=010121&market=528",
        ),
      ),
    ).toBe("primary-market-analysis");
    expect(
      workspaceRouteFamily(
        parseTradeAnalysisContext(
          "/?recipe=opportunity-discovery-v1&exporter=156",
        ),
      ),
    ).toBe("primary-opportunities");
  });

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
