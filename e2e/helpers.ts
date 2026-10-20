import { type Page, expect } from "@playwright/test";

export const A = "projects/merchant-categorizer/versions/A.md";

export async function boot(page: Page, name = `t${Math.random().toString(36).slice(2, 8)}`, o: { expand?: boolean; tutorial?: boolean } = {}) {
  if (!o.tutorial) await page.addInitScript(() => localStorage.setItem("contextide:tutorial-seen", "1"));
  await page.goto("/");
  await page.waitForFunction(() => !!(window as any).__contextide);
  await page.evaluate((n) => (window as any).__contextide.openBrowserWorkspace(n), name);
  await expect(page.getByTestId("editor")).toBeVisible();
  await expect(page.getByTestId("token-count")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  if (o.expand !== false) await expandLibrary(page);
}

export async function expandLibrary(page: Page) {
  for (const k of ["directive", "section", "insertion", "tool", "schema", "data"]) {
    const t = page.getByTestId(`toggle-group-${k}`);
    if ((await t.getAttribute("aria-expanded")) !== "true") await t.click();
  }
}

export const hook = <T>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => (window as any).__contextide[f as string](...(a as unknown[])), [fn, args] as const) as Promise<T>;

export const editorText = (page: Page) => hook<string>(page, "editorText");
export const rendered = (page: Page) => hook<string>(page, "rendered");
export const file = async (page: Page, path: string) => (await hook<Record<string, string>>(page, "files"))[path];

/** Wait until a file on disk satisfies a predicate (autosave is debounced). */
export async function expectFile(page: Page, path: string, pred: (t: string | undefined) => boolean, msg = path) {
  await expect.poll(async () => pred(await file(page, path)), { message: msg, timeout: 5000 }).toBe(true);
}

/** Put the caret at the end of the line containing `text` (deterministic, via the editor state). */
export async function caretAfter(page: Page, text: string) {
  expect(await hook<boolean>(page, "caret", text, "end")).toBe(true);
}

export async function select(page: Page, a: string, b?: string) {
  expect(await hook<boolean>(page, "select", a, b)).toBe(true);
}

export const mod = process.platform === "darwin" ? "Meta" : "Control";

/** A real, stepwise mouse drag (Playwright's dragTo skips dragstart on hover-revealed handles). */
export async function mouseDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y - 5, { steps: 5 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

/** Pick an option in a shadcn/Radix Select by its value. */
export async function choose(page: Page, testid: string, value: string) {
  await page.getByTestId(testid).click();
  await page.locator(`[role=option][data-value="${value}"]`).click();
}
