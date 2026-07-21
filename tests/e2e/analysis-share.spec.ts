import { expect, test } from "@playwright/test";

test("an Export Market Analyst copies a shareable analysis link", async ({
  page,
}) => {
  await page.goto(
    "/?locale=en&exporter=156&revision=HS12&product=010121&market=484",
  );

  await expect(
    page.getByRole("list", { name: "Candidate Markets" }).getByRole("button"),
  ).toHaveCount(13);

  const copyLink = page.getByRole("button", {
    name: "Copy Market Analysis link",
  });
  await expect(copyLink).toBeVisible();

  await copyLink.click();

  await expect(
    page.getByRole("button", { name: "Link copied" }),
  ).toBeVisible();
});

test("the share affordance is localized for Simplified Chinese", async ({
  page,
}) => {
  await page.goto(
    "/?locale=en&exporter=156&revision=HS12&product=010121&market=484",
  );

  await expect(
    page.getByRole("list", { name: "Candidate Markets" }).getByRole("button"),
  ).toHaveCount(13);

  await page.getByRole("button", { name: "简体中文" }).click();

  await expect(
    page.getByRole("button", { name: "复制市场分析链接" }),
  ).toBeVisible();
});
