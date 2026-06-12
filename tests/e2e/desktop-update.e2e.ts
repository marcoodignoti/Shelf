import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("opennotion-e2e-pages", "[]");

    (window as Window & { __installUpdateCalls?: number }).__installUpdateCalls = 0;
    window.openNotion = {
      invoke: async (cmd: string) => {
        if (cmd === "list_pages" || cmd === "list_all_pages") return [];
        if (cmd === "list_studio_documents" || cmd === "list_studio_projects" || cmd === "list_all_studio_document_page_links") return [];
        if (cmd === "get_page") return null;
        if (cmd === "get_workspace_profile") return { name: "", workspaceName: "Shelf", avatarPath: null };
        throw new Error(`Unhandled e2e command: ${cmd}`);
      },
      open: async () => null,
      save: async () => null,
      fileSrc: (filePath: string) => filePath,
      autoUpdateActive: () => true,
      installUpdateNow: async () => {
        const host = window as Window & { __installUpdateCalls?: number };
        host.__installUpdateCalls = (host.__installUpdateCalls ?? 0) + 1;
        return null;
      },
      onDesktopUpdate: (callback: (eventName: string, payload: unknown) => void) => {
        window.setTimeout(() => {
          callback("desktop-update-downloaded", { version: "9.9.9" });
        }, 50);
        return () => {};
      },
    };
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
