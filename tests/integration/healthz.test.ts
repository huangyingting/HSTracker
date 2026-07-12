import { afterEach, describe, expect, it } from "vitest";

import { GET, HEAD } from "../../src/app/healthz/route";

const originalBuildId = process.env.APP_BUILD_ID;

afterEach(() => {
  if (originalBuildId === undefined) {
    delete process.env.APP_BUILD_ID;
  } else {
    process.env.APP_BUILD_ID = originalBuildId;
  }
});

describe("GET /healthz", () => {
  it("reports the application build without allowing caches", async () => {
    process.env.APP_BUILD_ID = "acceptance-fixtures-v1";

    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      buildId: "acceptance-fixtures-v1",
    });

    const head = HEAD();
    expect(head.status).toBe(200);
    expect(head.headers.get("cache-control")).toBe("no-store");
    expect(await head.text()).toBe("");
  });
});
