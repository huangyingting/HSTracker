import { expect, test } from "@playwright/test";

test("the running application exposes its health and build identity", async ({
  request,
}) => {
  const response = await request.get("/healthz");

  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("no-store");
  await expect(response.json()).resolves.toEqual({
    status: "ok",
    buildId: "playwright-fixture",
  });
});
