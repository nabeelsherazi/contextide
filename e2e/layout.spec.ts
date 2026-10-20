import { test, expect } from "@playwright/test";
import { boot } from "./helpers";

for (const width of [1440, 1100, 900])
  for (const collapsed of [true, false])
  test(`no horizontal scroll at ${width}px, drawers ${collapsed ? "collapsed" : "open"}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await boot(page);
    if (collapsed) {
      await page.getByTestId("toggle-left").click();
      await page.getByTestId("toggle-right").click();
    }
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => {
      const offenders: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>("*")) {
        const r = el.getBoundingClientRect();
        if (r.right > window.innerWidth + 1 && r.width > 0) offenders.push(`${el.tagName}.${el.className}`.slice(0, 80));
      }
      const scrollers = [document.scrollingElement!, document.querySelector<HTMLElement>("[data-testid=page]")!].map((e) => e.scrollWidth - e.clientWidth);
      return { scrollers, offenders: offenders.slice(0, 8) };
    });
    expect(overflow.scrollers, JSON.stringify(overflow.offenders)).toEqual([0, 0]);
  });
