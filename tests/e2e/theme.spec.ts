import { expect, test } from "@playwright/test";

// The theme is a browser-local preference, not part of the canonical task
// link: it must apply before first paint, survive reload, honour the OS
// preference on a first visit, and never leak into the shareable URL.

test("[launch-evidence:theme-persistence] the workspace defaults to light and remembers a switch to dark across reload", async ({
  page,
}) => {
  await page.goto("/");

  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "light");

  const toDark = page.getByRole("switch", { name: "Switch to dark theme" });
  await expect(toDark).toBeVisible();
  await expect(toDark).toHaveAttribute("aria-checked", "false");
  await toDark.click();

  await expect(html).toHaveAttribute("data-theme", "dark");
  const toLight = page.getByRole("switch", { name: "Switch to light theme" });
  await expect(toLight).toHaveAttribute("aria-checked", "true");

  // The preference is canonical to the browser, not the URL.
  await expect(page).toHaveURL("/");

  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(
    page.getByRole("switch", { name: "Switch to light theme" }),
  ).toBeVisible();
});

test("a first visit with no stored choice honours a dark system preference", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("an explicit stored choice overrides the system preference", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await page.getByRole("switch", { name: "Switch to light theme" }).click();

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("the theme control is localized without changing the URL", async ({
  page,
}) => {
  await page.goto("/?locale=zh-Hans");

  await expect(
    page.getByRole("switch", { name: "切换到深色主题" }),
  ).toBeVisible();
  await expect(page).toHaveURL("/?locale=zh-Hans");
});
