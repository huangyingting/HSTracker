import { expect, test } from "@playwright/test";

test("Opportunity Discovery requires an explicit Candidate Market action before opening analysis", async ({
  page,
}) => {
  const momentumRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/recent-trade-momentum?")) {
      momentumRequests.push(request.url());
    }
  });

  await page.goto(
    "/?recipe=opportunity-discovery&exporter=156&revision=HS12&product=010121&market=528",
  );

  const candidates = page
    .getByRole("list", { name: "Market Investigation Candidates" });
  await expect(candidates.getByRole("listitem")).toHaveCount(2);
  await expect(candidates.getByRole("link")).toHaveCount(2);
  await expect(candidates.getByRole("button")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: /Market Analysis/ }),
  ).toHaveCount(0);
  expect(momentumRequests).toEqual([]);

  await candidates
    .getByRole("link", {
      name: "Analyze this market: Netherlands, HS12 010121",
    })
    .click();

  await expect(
    page.getByRole("heading", { name: "Netherlands · Market Analysis" }),
  ).toBeVisible();
});
