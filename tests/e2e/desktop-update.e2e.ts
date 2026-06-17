import { expect, test } from "@playwright/test";
import { installMockBridge } from "./helpers/mockBridge";

test.beforeEach(async ({ page }) => {
  await installMockBridge(page, {
    triggerDesktopUpdate: true,
  });
});

test("shows restart-to-update notice and triggers install on click", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const notice = page.getByRole("status").filter({ hasText: "Update ready" });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("9.9.9");

  await notice.getByRole("button", { name: "Restart to update" }).click();
  await expect.poll(async () =>
    page.evaluate(() => (window as Window & { __installUpdateCalls?: number }).__installUpdateCalls)
  ).toBe(1);
});

test("restart notice can be dismissed and installs on quit instead", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const notice = page.getByRole("status").filter({ hasText: "Update ready" });
  await expect(notice).toBeVisible();
  await notice.getByRole("button", { name: "Dismiss update notice" }).click();
  await expect(notice).toBeHidden();
});
