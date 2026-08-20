import { expect, test, type Page } from "@playwright/test";

/** Fails the test on any console error, so a thrown island is never silent. */
function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

function rate(text: string | null): number {
  return Number(/[\d.]+/.exec(text ?? "")?.[0]);
}

test("the page builds all three structures at the defaults", async ({
  page,
}) => {
  const errors = watchConsole(page);
  await page.goto("/start/playground/");

  for (const structure of ["bloom", "blocked", "fuse8"]) {
    const row = page.locator(`[data-row='${structure}']`);
    await expect(row.locator("[data-cell='bits']")).not.toBeEmpty();
    await expect(row.locator("[data-cell='fpr']")).not.toBeEmpty();
  }

  const bloom = await page
    .locator("[data-row='bloom'] [data-cell='fpr']")
    .textContent();
  expect(rate(bloom)).toBeGreaterThanOrEqual(0.005);
  expect(rate(bloom)).toBeLessThanOrEqual(0.02);
  expect(errors).toEqual([]);
});

test("the page states the guarantee and the bound", async ({ page }) => {
  await page.goto("/start/playground/");
  const body = page.locator("main");

  await expect(body).toContainText("guaranteed");
  await expect(body).toContainText("100,000");
});

test("the build is repeatable from the button, at a new key count", async ({
  page,
}) => {
  const errors = watchConsole(page);
  await page.goto("/start/playground/");

  await page.fill("#pg-keys", "50000");
  await page.getByRole("button", { name: "Build" }).click();

  await expect(
    page.locator("[data-row='bloom'] [data-cell='held']"),
  ).toHaveText("50,000");
  expect(errors).toEqual([]);
});
