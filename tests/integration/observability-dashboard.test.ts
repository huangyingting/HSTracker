import dashboard from "../../deployment/grafana-dashboard.json";
import { describe, expect, it } from "vitest";

describe("production observability dashboard", () => {
  it("retains the request SLI and operational panels with build identity", () => {
    expect(dashboard).toMatchObject({
      uid: "hs-tracker-production",
      title: "HS Tracker Production",
      refresh: "30s",
      templating: {
        list: [
          { name: "analysis_build_id" },
          { name: "baci_release" },
          { name: "route_family" },
        ],
      },
    });
    expect(dashboard.panels.map((panel) => panel.title)).toEqual([
      "UTC month-to-date request SLI",
      "Request rate",
      "Route p95 / p99",
      "500 / 503 rate",
      "Queue wait and depth",
      "Cgroup memory and process RSS",
      "Process cache bytes",
      "Source freshness polling and alerts",
      "Spill, volume, and CPU throttling",
      "Deployment activation mode",
    ]);

    const expressions = dashboard.panels.flatMap((panel) =>
      panel.targets.map((target) => target.expr),
    );
    expect(expressions[0]).toContain('synthetic="false"');
    expect(expressions[0]).toContain("[$__range]");
    expect(expressions[0]).toContain(
      'status!~"400|404|409|410"',
    );
    expect(expressions.join("\n")).toContain(
      'analysis_build_id=~"$analysis_build_id"',
    );
    expect(expressions.join("\n")).toContain(
      'baci_release=~"$baci_release"',
    );
    expect(dashboard.time).toEqual({ from: "now/M", to: "now" });
    expect(expressions).toContain("hs_tracker_deployment_activation_mode");
    expect(expressions).toContain(
      "hs_tracker_deployment_activation_fallback_reason",
    );
    expect(JSON.stringify(dashboard)).not.toContain("correlation_id");
    expect(JSON.stringify(dashboard)).not.toContain("normalized_query");
  });
});
