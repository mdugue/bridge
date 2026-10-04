import { expect, test } from "@playwright/test";

/**
 * /impressum and /datenschutz (ADR 0045): reachable from the start page's
 * footer and from each other. What they name depends on the build's
 * environment (the operator, the DSN), so only their frame is checked
 * here; lib/legal.test.ts covers what the environment turns into.
 */
test.describe("legal pages", () => {
  test("the start page links the Impressum and the privacy policy", async ({
    page,
  }) => {
    await page.goto("/");
    const legal = page.getByRole("navigation", { name: "Rechtliches" });
    await legal.getByRole("link", { name: "Impressum" }).click();
    await expect(page).toHaveURL(/\/impressum$/u);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Impressum"
    );
    await page
      .getByRole("navigation", { name: "Rechtliches" })
      .getByRole("link", { name: "Datenschutz" })
      .click();
    await expect(page).toHaveURL(/\/datenschutz$/u);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Datenschutzerklärung"
    );
  });

  test("the privacy policy names the host and the reports", async ({
    page,
  }) => {
    await page.goto("/datenschutz");
    await expect(page.locator("article")).toContainText("Vercel Inc.");
    await expect(page.locator("#fehlerberichte")).toBeVisible();
  });
});
