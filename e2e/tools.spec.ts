import { test, expect } from "@playwright/test";
import { boot, hook, toolWorkflow, mockToolLLM, TOOL_DEMO as P } from "./helpers";

test.beforeEach(async ({ page }) => boot(page, undefined, { expand: false }));

test("a run answers tool calls and shows the transcript", async ({ page }) => {
  await toolWorkflow(page);
  const calls = await mockToolLLM(page);
  await expect(page.getByTestId("tool-loop")).toContainText("looks up units by handle");
  await page.getByTestId("run").click();
  await expect(page.getByTestId("last-output")).toContainText("Summary from 2 lookups: The first unit, in full. / No unit u7.");
  expect(calls).toHaveLength(2);
  expect(calls[1].messages.at(-1)).toEqual({ role: "tool", tool_call_id: "c2", content: "No unit u7." });
  await page.getByTestId("tab-outputs").click();
  await expect(page.getByTestId("turn")).toHaveCount(2);
  await expect(page.getByTestId("tool-call").first()).toContainText('expand({"handle":"u1"})');
  await expect(page.getByTestId("tool-call").first()).toContainText("The first unit, in full.");
  // the run file keeps the transcript
  const runs = Object.entries(await hook<Record<string, string>>(page, "files")).filter(([p]) => p.startsWith(`${P}/runs/`));
  expect(runs).toHaveLength(1);
  expect(runs[0][1]).toContain("#### Call · expand");
});

test("the round cap and the final turn without tools are run settings", async ({ page }) => {
  await toolWorkflow(page);
  const calls = await mockToolLLM(page);
  await page.getByTestId("tool-rounds").fill("0");
  await page.getByTestId("tool-rounds").blur();
  await page.getByTestId("final-no-tools").click();
  await page.getByTestId("run").click();
  await expect(page.getByTestId("last-output")).toBeVisible();
  expect(calls).toHaveLength(2);
  expect(calls[0].tools).toHaveLength(1);
  expect(calls[1].tools).toBeUndefined();
  await expect.poll(async () => (await hook<Record<string, string>>(page, "files"))[`${P}/project.json`]).toContain('"finalNoTools": true');
});
