import { expect, test } from "@playwright/test";

test("Opportunity Discovery shows Recent Trade Momentum beside the selected candidate without changing the candidate list", async ({
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
    .getByRole("list", { name: "Market Investigation Candidates" })
    .getByRole("button");
  await expect(candidates).toHaveCount(2);

  const momentum = page.getByRole("region", {
    name: "Recent Trade Momentum Signal",
  });
  await expect(momentum.getByText("Mexico", { exact: true })).toBeVisible();
  await expect(momentum.getByText("Reporting market")).toBeVisible();
  await expect(momentum.getByText("MX", { exact: true })).toBeVisible();
  await expect(momentum.getByText("SMALL_BASE")).toBeVisible();
  await expect(
    momentum.getByText(
      "Monthly momentum is separate context; it does not change the annual BACI opportunity score, rank, type, or confidence.",
    ),
  ).toBeVisible();
  expect(momentumRequests.at(-1)).toContain("reporter=MX");
  expect(momentumRequests.at(-1)).toContain("product=010121");
  expect(momentumRequests.at(-1)).toContain("exporter=156");

  await candidates.filter({ hasText: "Netherlands" }).click();

  await expect(momentum.getByText("Netherlands", { exact: true })).toBeVisible();
  await expect(momentum.getByText("NL", { exact: true })).toBeVisible();
  await expect(momentum.getByText("RISING_FAST")).toBeVisible();
  await expect(momentum.getByText("+25.0%")).toBeVisible();
  await expect(candidates).toHaveCount(2);
  expect(momentumRequests.at(-1)).toContain("reporter=NL");
  expect(momentumRequests.at(-1)).toContain("product=010121");
  expect(momentumRequests.at(-1)).toContain("exporter=156");
});
