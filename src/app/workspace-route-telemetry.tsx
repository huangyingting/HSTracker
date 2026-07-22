"use client";

import { useEffect, useRef } from "react";

import type { WorkspaceRouteFamily } from "../domain/workspace-route-family";
import type { TradeAnalysisContext } from "./trade-analysis-context";
import { workspaceRouteFamily } from "./workspace-route-family";

export function WorkspaceRouteTelemetry({
  context,
}: {
  context: TradeAnalysisContext;
}) {
  const routeFamily = workspaceRouteFamily(context);
  const lastReportedRouteFamily = useRef<WorkspaceRouteFamily | null>(null);

  useEffect(() => {
    if (lastReportedRouteFamily.current === routeFamily) {
      return;
    }
    lastReportedRouteFamily.current = routeFamily;

    void fetch("/api/telemetry/workspace-route", {
      method: "POST",
      cache: "no-store",
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ routeFamily }),
      keepalive: true,
      referrerPolicy: "no-referrer",
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Telemetry request failed with ${response.status}.`);
        }
      })
      .catch((error: unknown) => {
        console.error("Anonymous workspace route telemetry failed", error);
      });
  }, [routeFamily]);

  return null;
}
