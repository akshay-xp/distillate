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

test("the two inputs are the same size and line up", async ({ page }) => {
  await page.goto(PAGE);

  const capacity = await page.locator("#sizing-capacity").boundingBox();
  const epsilon = await page.locator("#sizing-epsilon").boundingBox();
  if (!capacity || !epsilon) throw new Error("inputs not rendered");

  expect(Math.abs(capacity.width - epsilon.width)).toBeLessThan(1);
  expect(Math.abs(capacity.y - epsilon.y)).toBeLessThan(1);
});

test("does not scroll horizontally on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(PAGE);

  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // The results table is allowed to scroll, but inside its own box.
  const table = page.locator("[data-sizing-results]");
  await expect(table).toHaveCSS("overflow-x", "auto");
});

test("groups the capacity digits with commas as you type", async ({ page }) => {
  await page.goto(PAGE);

  const capacity = page.locator("#sizing-capacity");
  await expect(capacity).toHaveValue("1,000,000");

  await capacity.fill("100000000");
  await expect(capacity).toHaveValue("100,000,000");
  // The grouped value still parses, so results track it.
  await expect(row(page, "bloom")).toContainText("114.26 MiB");

  // Non-numeric text is left alone so the validation message can explain it.
  await capacity.fill("abc");
  await expect(capacity).toHaveValue("abc");
  await expect(row(page, "bloom")).toContainText(/capacity/i);
});

test("keeps the caret put while regrouping", async ({ page }) => {
  await page.goto(PAGE);
  const capacity = page.locator("#sizing-capacity");

  // Type past the first comma, so the inserted digit really does move every
  // separator. Inserting right after the leading digit would not: "1,000,000"
  // becomes "12,000,000", which is already grouped, and regrouping no-ops.
  await capacity.click();
  await page.keyboard.press("Home");
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.type("2");

  await expect(capacity).toHaveValue("10,200,000");
  const caret = await capacity.evaluate(
    (el) => (el as HTMLInputElement).selectionStart,
  );
  // Right after the typed "2", not flung to the end by the reformat.
  expect(caret).toBe(4);
});
