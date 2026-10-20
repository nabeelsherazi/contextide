import { test } from "@playwright/test";
import { boot } from "./helpers";
const dir = process.env.SHOTS!;
test.skip(!dir, "screenshots only on demand");
test("screens", async ({ page }) => {
  await boot(page, "shots", { tutorial: true, expand: false });
  await page.getByTestId("tour-next").click();
  await page.getByTestId("tour-next").click();
  await page.getByTestId("tour-next").click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${dir}/5-tour.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${dir}/6-spacing.png` });
});
