import { afterEach, describe, expect, it, vi } from "vitest";

import { GET, HEAD } from "../../src/app/healthz/route";
import {
  createFixtureApplicationRuntime,
  installApplicationRuntime,
} from "../../src/runtime/application-runtime";

const originalBuildId = process.env.APP_BUILD_ID;

afterEach(() => {
  if (originalBuildId === undefined) {
    delete process.env.APP_BUILD_ID;
  } else {
    process.env.APP_BUILD_ID = originalBuildId;
  }
  vi.useRealTimers();
});

describe("GET /healthz", () => {
  it("reports the application build without allowing caches", async () => {
    process.env.APP_BUILD_ID = "acceptance-fixtures-v1";

    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-hs-tracker-build-id")).toBe(
      "acceptance-fixtures-v1",
    );
    expect(response.headers.get("x-hs-tracker-machine-class")).toBeTruthy();
    expect(response.headers.get("x-hs-tracker-machine-id")).toBeTruthy();
    expect(response.headers.get("x-hs-tracker-region")).toBeTruthy();
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      buildId: "acceptance-fixtures-v1",
    });

    const head = HEAD();
    expect(head.status).toBe(200);
    expect(head.headers.get("cache-control")).toBe("no-store");
    expect(await head.text()).toBe("");
  });

  it("fails closed when health work exceeds two seconds", async () => {
    vi.useFakeTimers();
    const fixture = createFixtureApplicationRuntime();
    const restore = installApplicationRuntime({
      ...fixture,
      health(buildId) {
        vi.advanceTimersByTime(2_001);
        return fixture.health(buildId);
      },
    });

    try {
      const response = GET();

      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "REQUEST_DEADLINE_EXCEEDED" },
      });

      const head = HEAD();
      expect(head.status).toBe(503);
      expect(await head.text()).toBe("");
    } finally {
      restore();
    }
  });
});
