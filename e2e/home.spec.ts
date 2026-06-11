import { expect, test } from "@playwright/test";

test("home page renders the getting-started heading", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /edit the page\.tsx file/i })
  ).toBeVisible();
});
