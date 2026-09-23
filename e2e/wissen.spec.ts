import { expect, test } from "@playwright/test";

/**
 * The knowledge base under /wissen: docs/ rendered at build time, diagrams
 * inlined as SVG. No WebGL here, so these run in seconds.
 */
test.describe("/wissen", () => {
  test("the entry lists the guide in both languages", async ({ page }) => {
    await page.goto("/wissen");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Nutzerdokumentation"
    );
    const menu = page.getByRole("navigation", { name: "Wissen" }).first();
    await expect(
      menu.getByRole("link", { name: "Der Weg der Daten" })
    ).toBeVisible();
    await expect(
      menu.getByRole("link", { name: "From download to browser" })
    ).toBeVisible();
  });

  test("a guide page carries its prerendered diagrams and its twin", async ({
    page,
  }) => {
    await page.goto("/wissen/de/data-journey");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Der Weg der Daten"
    );
    await expect(page.locator("article")).toHaveAttribute("lang", "de");
    // Mermaid never reaches the browser: the SVG is in the HTML.
    const diagram = page.locator("figure.diagram svg").first();
    await expect(diagram).toBeVisible();
    await expect(diagram).toContainText("Portale der Anbieter");
    await page.getByRole("link", { name: "English version →" }).click();
    await expect(page).toHaveURL(/\/wissen\/en\/data-journey$/u);
  });

  test("links between docs stay on the site, the rest goes to GitHub", async ({
    page,
  }) => {
    await page.goto("/wissen/dev");
    await expect(
      page.locator("article a[href='/wissen/dev/data-pipeline']").first()
    ).toBeVisible();
    await expect(
      page
        .locator(
          "article a[href^='https://github.com/mdugue/bridge/blob/main/AGENTS.md']"
        )
        .first()
    ).toBeAttached();
  });

  test("an unknown page is a 404", async ({ page }) => {
    const response = await page.goto("/wissen/dev/no-such-page");
    expect(response?.status()).toBe(404);
  });
});
