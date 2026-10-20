import { test, expect } from "@playwright/test";
import { boot } from "./helpers";

test("first launch shows the tutorial once; it can be replayed from settings", async ({ page }) => {
  await boot(page, "tut", { tutorial: true, expand: false });
  const tour = page.getByTestId("tour");
  await expect(tour).toBeVisible();
  await expect(tour).toContainText("Welcome to ContextIDE");
  const titles: string[] = [];
  for (let i = 0; i < 8; i++) {
    titles.push((await tour.locator("h3").textContent()) ?? "");
    // every step after the welcome spotlights a real element
    if (i > 0) await expect(tour.locator(".cx-tour-spot"), `step ${i + 1} has a spotlight`).toBeVisible();
    await page.getByTestId("tour-next").click();
  }
  expect(titles).toEqual(["Welcome to ContextIDE", "Projects and versions", "The page", "Directives and sections", "The library", "Data, insertions, tools", "Know your context", "Run and compare"]);
  await expect(tour).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem("contextide:tutorial-seen"))).toBe("1");

  // a fresh load does not show it again
  await page.reload();
  await page.waitForFunction(() => !!(window as any).__contextide);
  await page.evaluate(() => (window as any).__contextide.openBrowserWorkspace("tut2"));
  await expect(page.getByTestId("editor")).toBeVisible();
  await expect(tour).toBeHidden();

  // replay from settings; Escape skips
  await page.getByTestId("open-settings").click();
  await page.getByTestId("replay-tutorial").click();
  await expect(tour).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(tour).toContainText("Projects and versions");
  await page.keyboard.press("Escape");
  await expect(tour).toBeHidden();
});

test("library groups start collapsed; search reveals matches", async ({ page }) => {
  await boot(page, undefined, { expand: false });
  for (const k of ["directive", "section", "insertion", "tool", "schema", "data"]) await expect(page.getByTestId(`toggle-group-${k}`)).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("block-directive:safety/anti-prompt-injection")).toBeHidden();
  await page.getByTestId("library-search").fill("injection");
  await expect(page.getByTestId("block-directive:safety/anti-prompt-injection")).toBeVisible();
  await page.getByTestId("library-search").fill("");
  await page.getByTestId("toggle-group-directive").click();
  await expect(page.getByTestId("block-directive:tone/address-as-you")).toBeVisible();
});
