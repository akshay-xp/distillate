import { expect, test } from "@playwright/test";

const PAGE = "/guides/sizing/calculator/";

function row(page: import("@playwright/test").Page, key: string) {
  return page.locator(`[data-row='${key}']`);
}

test("computes every structure at the default inputs", async ({ page }) => {
  await page.goto(PAGE);

  // Defaults are 1,000,000 keys at 0.01.
  await expect(row(page, "bloom")).toContainText("9.59");
  await expect(row(page, "blocked")).toContainText("11.00");
  await expect(row(page, "fuse8")).toContainText("9.04");
  await expect(row(page, "fuse16")).toContainText("18.09");
  await expect(row(page, "bloom")).toContainText("MiB");
});

test("recomputes when the inputs change", async ({ page }) => {
  await page.goto(PAGE);
  await expect(row(page, "bloom")).toContainText("9.59");

  await page.fill("#sizing-capacity", "100000000");
  await expect(row(page, "bloom")).toContainText("114.26 MiB");
});

test("shows the space-penalty advisory only where it applies", async ({
  page,
}) => {
  await page.goto(PAGE);
  const warnings = page.locator("[data-sizing-warnings]");

  await expect(warnings).toBeEmpty();

  await page.fill("#sizing-epsilon", "1e-5");
  await expect(warnings).toContainText("41");
  await expect(warnings).toContainText("24");
});

test("surfaces the blocked floor and bad input in the page, not the console", async ({
  page,
}) => {
  const noise: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") noise.push(m.text());
  });
  page.on("pageerror", (e) => noise.push(e.message));

  await page.goto(PAGE);

  await page.fill("#sizing-epsilon", "1e-9");
  await expect(row(page, "blocked")).toContainText(/floor/i);

  await page.fill("#sizing-capacity", "abc");
  for (const key of ["bloom", "blocked", "fuse8", "fuse16"]) {
    await expect(row(page, key)).toContainText(/capacity/i);
  }

  expect(noise).toEqual([]);
});
