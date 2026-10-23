import { test, expect } from "@playwright/test";
import { boot, choose, expectFile, hook } from "./helpers";

test.beforeEach(async ({ page }) => boot(page, undefined, { expand: false }));

test("a fan-out run's outputs save as a data source of another workflow", async ({ page }) => {
  // the next stage: a workflow that will read the outputs
  await hook(page, "writeDisk", "projects/next-stage/project.json", "{}");
  await page.route("http://localhost:1234/v1/chat/completions", async (route) => {
    const text = route.request().postDataJSON().messages.map((m: any) => m.content).join("\n");
    const content = text.includes("NETFLIX") ? "not json" : JSON.stringify({ label: "seen" });
    await route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body: JSON.stringify({ choices: [{ message: { content } }] }) });
  });
  await page.getByTestId("run-mode").locator("[data-value=fanout]").click();
  await page.getByTestId("run").click();
  await page.getByTestId("tab-outputs").click();
  await page.getByTestId("save-outputs").click({ timeout: 15000 });
  await expect(page.getByTestId("save-outputs-preview")).toContainText('"label":"seen"');
  await choose(page, "save-outputs-target", "next-stage");
  await page.getByTestId("save-outputs-name").fill("labelled");
  await page.getByTestId("save-outputs-ok").click();
  const path = "projects/next-stage/data/labelled.jsonl";
  await expectFile(page, path, (t) => t?.trim().split("\n").length === 16);
  const lines = (await hook<Record<string, string>>(page, "files"))[path].trim().split("\n").map((l) => JSON.parse(l));
  expect(lines[0]).toMatchObject({ name: expect.any(String), mcc: expect.any(String), label: "seen" });
  expect(lines.find((l) => l.name.startsWith("NETFLIX"))).toMatchObject({ output: "not json" });
});
