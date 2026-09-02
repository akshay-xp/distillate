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

  // The cell renders the measured rate as a percentage, so the parsed
  // figure is compared against percentage bounds (half to double the 1%
  // default target), not the raw fraction.
  const bloom = await page
    .locator("[data-row='bloom'] [data-cell='fpr']")
    .textContent();
  expect(rate(bloom)).toBeGreaterThanOrEqual(0.5);
  expect(rate(bloom)).toBeLessThanOrEqual(2);
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

async function query(page: Page, key: string): Promise<void> {
  await page.fill("#pg-query", key);
  await page.getByRole("button", { name: "Query" }).click();
}

function verdict(page: Page, structure: string) {
  return page.locator(`[data-row='${structure}'] [data-cell='verdict']`);
}

test("an inserted key reads as a member in every structure", async ({
  page,
}) => {
  const errors = watchConsole(page);
  await page.goto("/start/playground/");

  await query(page, "key-5");

  for (const structure of ["bloom", "blocked", "fuse8"]) {
    await expect(verdict(page, structure)).toHaveText("member");
  }
  expect(errors).toEqual([]);
});

test("a hit on a never-inserted key is named a false positive", async ({
  page,
}) => {
  await page.goto("/start/playground/");

  await query(page, "miss-22");

  await expect(verdict(page, "bloom")).toHaveText("false positive");
  await expect(page.locator("main")).toContainText("not a bug");
});

test("a miss on a never-inserted key is simply absent", async ({ page }) => {
  await page.goto("/start/playground/");

  await query(page, "miss-0");

  for (const structure of ["bloom", "blocked", "fuse8"]) {
    await expect(verdict(page, structure)).toHaveText("absent");
  }
});

async function add(page: Page, key: string): Promise<void> {
  await page.fill("#pg-add", key);
  await page.getByRole("button", { name: "Add" }).click();
}

test("a late key is taken by the bloom filters and refused by fuse", async ({
  page,
}) => {
  const errors = watchConsole(page);
  await page.goto("/start/playground/");

  await add(page, "late-key");

  const status = page.locator("[data-pg-status]");
  await expect(status).toContainText("Binary Fuse");
  await expect(status).toContainText("static");
  await expect(
    page.locator("[data-row='bloom'] [data-cell='held']"),
  ).toHaveText("10,001");
  await expect(
    page.locator("[data-row='fuse8'] [data-cell='held']"),
  ).toHaveText("10,000");
  expect(errors).toEqual([]);
});

test("a late key reads as outside the fuse build, not as a miss", async ({
  page,
}) => {
  await page.goto("/start/playground/");

  await add(page, "late-key");
  await query(page, "late-key");

  await expect(verdict(page, "bloom")).toHaveText("member");
  await expect(verdict(page, "blocked")).toHaveText("member");
  await expect(verdict(page, "fuse8")).toHaveText("added after build");
});

test("no structure gains a false negative from a late key", async ({
  page,
}) => {
  await page.goto("/start/playground/");

  await add(page, "late-key");

  for (const structure of ["bloom", "blocked", "fuse8"]) {
    await expect(
      page.locator(`[data-row='${structure}'] [data-cell='missing']`),
    ).toHaveText("0");
  }
});

test("adding a key clears a verdict it has just invalidated", async ({
  page,
}) => {
  await page.goto("/start/playground/");

  await query(page, "late-key");
  await expect(verdict(page, "bloom")).toHaveText("absent");

  await add(page, "late-key");

  await expect(verdict(page, "bloom")).toBeEmpty();
});

test("a key count past the bound is refused in the page", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/start/playground/");
  const held = page.locator("[data-row='bloom'] [data-cell='held']");
  await expect(held).toHaveText("10,000");

  await page.fill("#pg-keys", "200000");
  await page.getByRole("button", { name: "Build" }).click();

  await expect(page.locator("[data-pg-status]")).toContainText("100,000");
  await expect(held).toHaveText("10,000");
  expect(errors).toEqual([]);
});

test("an unusable target rate is refused in the page", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/start/playground/");

  await page.fill("#pg-target", "1.5");
  await page.getByRole("button", { name: "Build" }).click();

  await expect(page.locator("[data-pg-status]")).toContainText(
    "open interval (0, 1)",
  );
  expect(errors).toEqual([]);
});

test("a target under the blocked floor names the floor, in the page", async ({
  page,
}) => {
  const errors = watchConsole(page);
  await page.goto("/start/playground/");

  await page.fill("#pg-target", "1e-9");
  await page.getByRole("button", { name: "Build" }).click();

  await expect(page.locator("[data-pg-status]")).toContainText(
    "below the blocked-filter floor",
  );
  expect(errors).toEqual([]);
});

test("the playground has a sidebar entry", async ({ page }) => {
  await page.goto("/start/what-is-an-amq-filter/");

  const entry = page
    .locator("nav")
    .getByRole("link", { name: "Playground", exact: true });

  await expect(entry).toHaveAttribute("href", "/start/playground/");
});

test("the page that introduces the guarantee links to the demo", async ({
  page,
}) => {
  await page.goto("/start/what-is-an-amq-filter/");

  await page
    .locator("main")
    .getByRole("link", { name: /playground/i })
    .first()
    .click();

  await expect(page).toHaveURL(/\/start\/playground\/$/);
  await expect(
    page.locator("[data-row='bloom'] [data-cell='held']"),
  ).toHaveText("10,000");
});
