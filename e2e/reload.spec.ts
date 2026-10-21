import { test, expect } from "@playwright/test";

test("reloading a saved workspace never flashes the welcome page", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("contextide:tutorial-seen", "1");
    // record whether the welcome page is ever mounted, however briefly
    new MutationObserver(() => {
      if (document.querySelector(".cx-welcome")) (window as any).__sawWelcome = true;
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto("/");
  await page.getByTestId("browser-workspace").click();
  await expect(page.getByTestId("editor")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("editor")).toBeVisible();
  expect(await page.evaluate(() => (window as any).__sawWelcome ?? false)).toBe(false);
});
