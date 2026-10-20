import { test, expect, type Page } from "@playwright/test";
import { boot, choose, editorText, expectFile, hook, mod, file } from "./helpers";

test.beforeEach(async ({ page }) => boot(page));

/** Mock an OpenAI-compatible endpoint that answers merchants with gold labels (Netflix wrong). */
async function mockLLM(page: Page) {
  const gold: Record<string, string> = {};
  const g = await file(page, "projects/merchant-categorizer/data/merchant-gold.jsonl");
  for (const l of g.trim().split("\n")) {
    const r = JSON.parse(l);
    gold[r.name] = r.category[0];
  }
  const calls: any[] = [];
  await page.route("http://localhost:1234/v1/chat/completions", async (route) => {
    const body = route.request().postDataJSON();
    calls.push(body);
    const text = body.messages.map((m: any) => m.content).join("\n");
    const lines = Object.entries(gold)
      .filter(([n]) => text.includes(n))
      .map(([n, c]) => `${n} -> ${n.startsWith("NETFLIX") ? "fun.music" : c}`);
    await route.fulfill({
      status: 200,
      headers: { "access-control-allow-origin": "*", "content-type": "application/json" },
      body: JSON.stringify({ choices: [{ message: { content: lines.join("\n") }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 20 } }),
    });
  });
  return calls;
}

test("run, score, rate and note a run", async ({ page }) => {
  const calls = await mockLLM(page);
  await page.getByTestId("run").click();
  await page.getByTestId("tab-outputs").click();
  await expect(page.getByTestId("run-score")).toHaveText("94% (15/16)");
  await expect(page.getByTestId("run-output")).toContainText("NETFLIX.COM -> fun.music");
  expect(calls[0].temperature).toBe(0);
  expect(calls[0].messages[0].content).toContain("SQ *JOE COFFEE COMPANY");
  await page.getByTestId("rate-up").click();
  await page.getByTestId("run-note").fill("netflix confused with music");
  await page.getByTestId("run-note").blur();
  const runs = Object.entries(await hook<Record<string, string>>(page, "files")).filter(([p]) => p.includes("/runs/"));
  expect(runs).toHaveLength(1);
  await expectFile(page, runs[0][0], (t) => !!t?.includes("rating: up") && !!t.includes("note: netflix confused with music"));
});

test("fan-out sends chunks and still scores", async ({ page }) => {
  const calls = await mockLLM(page);
  await page.getByTestId("run-mode").locator("[data-value=fanout]").click();
  await page.getByTestId("fan-size").fill("4");
  await page.getByTestId("fan-size").blur();
  await page.getByTestId("run").click();
  await expect.poll(() => calls.length).toBe(4);
  await page.getByTestId("tab-outputs").click();
  await expect(page.getByTestId("run-score")).toHaveText("94% (15/16)");
});

test("ablation ranks the cards that matter", async ({ page }) => {
  await mockLLM(page);
  await page.getByTestId("run-mode").locator("[data-value=ablation]").click();
  await page.getByTestId("run").click();
  await page.getByTestId("tab-outputs").click();
  await page.getByRole("button", { name: "Diff against…" }).click({ timeout: 15000 });
  await expect(page.getByTestId("ablation")).toBeVisible();
  await expect(page.getByTestId("ablation").locator("tbody tr").first()).toContainText("section Merchants");
});

test("compare versions side by side", async ({ page }) => {
  await mockLLM(page);
  await choose(page, "compare", "B");
  await expect(page.getByTestId("diff-panel")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("word-diff")).toBeVisible();
});

test("unreachable endpoint gives a helpful error", async ({ page }) => {
  await page.route("http://localhost:1234/v1/chat/completions", (r) => r.abort("connectionrefused"));
  await page.getByTestId("run").click();
  await expect(page.getByTestId("run-error")).toContainText("CORS");
});

test("new version forks the current one", async ({ page }) => {
  await page.getByTestId("new-version").click();
  await page.getByTestId("version-subtitle").fill("xml everything");
  await page.getByTestId("new-version-ok").click();
  await expect(page.getByTestId("version-tab-C")).toBeVisible();
  await expectFile(page, "projects/merchant-categorizer/versions/C.md", (t) => !!t?.includes("subtitle: xml everything") && !!t.includes("You categorize merchants"));
});

test("create a data source, paste rows, and drop it on the page", async ({ page }) => {
  await page.getByTestId("new-data").click();
  await page.getByTestId("data-name").fill("Paragraphs");
  await page.getByTestId("new-data-ok").click();
  await expect(page.getByTestId("data-page")).toBeVisible();
  await page.getByTestId("data-text").fill("Great service.\n\nTerrible wait.\nNever again.\n");
  await page.getByTestId("data-split").locator("[data-value=paragraphs]").click();
  await expect(page.getByTestId("data-count")).toHaveText(/^2 items/);
  await expectFile(page, "projects/merchant-categorizer/data/paragraphs.txt", (t) => t === "Great service.\n\nTerrible wait.\nNever again.\n");
  await page.getByTestId("version-tab-A").click();
  await page.getByTestId("data-paragraphs").dragTo(page.locator(".cx-text", { hasText: "Answer with one line" }), { targetPosition: { x: 20, y: 4 } });
  expect(await editorText(page)).toContain('{{ data("paragraphs") }}');
  // configure the pipeline
  await page.locator(".cx-data", { hasText: "paragraphs" }).dblclick();
  await page.getByTestId("pipe-input").fill("numbered");
  await expect(page.getByTestId("pipe-preview")).toHaveText("1. Great service.\n2. Terrible wait.\nNever again.");
  await page.getByTestId("data-pipe-ok").click();
  expect(await editorText(page)).toContain('{{ data("paragraphs") | numbered }}');
});

test("new library block via the drawer, with a flavor variant", async ({ page }) => {
  await page.getByTestId("new-directive").click();
  await page.getByTestId("new-block-type").fill("tone");
  await page.getByTestId("new-block-fn").fill("Be brief");
  await page.getByTestId("new-block-ok").click();
  await expect(page.getByTestId("block-page")).toBeVisible();
  await page.getByTestId("block-page").locator(".ProseMirror").click();
  await page.keyboard.type("Answer in as few words as possible.");
  await expectFile(page, "library/directives/tone/be-brief.md", (t) => !!t?.includes("Answer in as few words as possible."));
  await choose(page, "add-variant", "gemini");
  await expectFile(page, "library/directives/tone/be-brief.gemini.md", (t) => !!t?.includes("flavor: gemini"));
});

test("palette runs commands", async ({ page }) => {
  await page.locator(".cx-text", { hasText: "You categorize" }).click();
  await page.keyboard.press(`${mod}+k`);
  await page.getByTestId("palette-input").fill("toggle rendered");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("rendered")).toBeVisible();
});

test("settings: theme and font persist", async ({ page }) => {
  await page.getByTestId("open-settings").click();
  await choose(page, "pref-font", "Libre Baskerville");
  await page.getByTestId("pref-theme").locator("[data-value=dark]").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const font = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--font-page"));
  expect(font).toContain("Libre Baskerville");
});

test("endpoint headers and extra body reach the request", async ({ page }) => {
  const settings = JSON.parse(await file(page, "contextide.json"));
  settings.endpoints.push({ id: "gw", name: "my gateway", baseUrl: "http://127.0.0.1:9999/v1", style: "chat", headers: { "x-client": "contextide" }, extraBody: { chat_template_kwargs: { enable_thinking: false } }, defaultModel: "some-model" });
  await hook(page, "writeDisk", "contextide.json", JSON.stringify(settings, null, 2));
  let seen: any = null;
  await page.route("http://127.0.0.1:9999/v1/chat/completions", async (route) => {
    seen = { headers: route.request().headers(), body: route.request().postDataJSON() };
    await route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body: JSON.stringify({ choices: [{ message: { content: "ok" } }] }) });
  });
  await choose(page, "run-endpoint", "gw");
  await page.getByTestId("run").click();
  await expect.poll(() => seen).not.toBeNull();
  expect(seen.headers["x-client"]).toBe("contextide");
  expect(seen.body.chat_template_kwargs).toEqual({ enable_thinking: false });
  expect(seen.body.model).toBe("some-model");
});

test("a single line saves only as a directive", async ({ page }) => {
  await page.locator(".cx-text", { hasText: "Answer with one line" }).click({ button: "right" });
  await page.getByTestId("menu-save-library").click();
  await expect(page.getByTestId("save-kind")).toContainText("directive");
  await expect(page.getByTestId("save-block").getByText("Section", { exact: true })).toHaveCount(0);
});

test("palette toggles day and night", async ({ page }) => {
  await page.locator(".cx-text", { hasText: "You categorize" }).click();
  await page.keyboard.press(`${mod}+k`);
  await page.getByTestId("palette-input").fill("day night");
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("variables are added with a checkmark", async ({ page }) => {
  await page.getByTestId("open-settings").click();
  await page.getByTestId("settings-variables").click();
  const kv = page.getByTestId("workspace-vars");
  await expect(kv.getByTestId("kv-add")).toBeDisabled();
  await kv.locator(".cx-kv-new input").first().fill("company");
  await kv.locator(".cx-kv-new input").nth(1).fill("Acme");
  await kv.getByTestId("kv-add").click();
  await expectFile(page, "contextide.json", (t) => !!t?.includes('"company": "Acme"'));
});
