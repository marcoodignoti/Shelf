import { describe, expect, it } from "vitest";
import {
  AI_MODELS,
  AI_PROVIDER_OPENROUTER,
  aiModelLabel,
  canTrustedModeAutoApply,
  formatAiActionPreview,
  isAllowedAiModel,
  type AiActionPlan,
} from "./ai";

describe("AI model allowlist", () => {
  it("ships approved free OpenRouter fallbacks and accepts dynamic free models", () => {
    expect(AI_PROVIDER_OPENROUTER).toBe("openrouter");
    expect(AI_MODELS.map((model) => model.id)).toEqual([
      "moonshotai/kimi-k2.6:free",
      "deepseek/deepseek-v4-flash:free",
    ]);
    expect(isAllowedAiModel("moonshotai/kimi-k2.6:free")).toBe(true);
    expect(isAllowedAiModel("qwen/qwen3-235b-a22b:free")).toBe(true);
    expect(isAllowedAiModel("openai/gpt-5")).toBe(false);
  });

  it("formats model labels without leaking provider internals", () => {
    expect(aiModelLabel("moonshotai/kimi-k2.6:free")).toBe("Kimi K2.6 Free");
    expect(aiModelLabel("deepseek/deepseek-v4-flash:free")).toBe("DeepSeek V4 Flash Free");
    expect(aiModelLabel("qwen/qwen3-235b-a22b:free", [{ id: "qwen/qwen3-235b-a22b:free", label: "Qwen3 Free" }])).toBe("Qwen3 Free");
  });
});

describe("AI action previews", () => {
  it("summarizes create-page and create-database plans", () => {
    const plan: AiActionPlan = {
      version: 1,
      summary: "Create study pages.",
      requires_confirmation: true,
      actions: [
        { type: "create_page", title: "Gauss", content_blocks: [] },
        {
          type: "create_database",
          title: "Exams",
          properties: [
            { id: "subject", name: "Subject", type: "text" },
            { id: "status", name: "Status", type: "select", options: ["Todo", "Done"] },
          ],
          starter_rows: [{ title: "Physics", properties: { subject: "Physics", status: "Todo" } }],
        },
      ],
    };

    expect(formatAiActionPreview(plan)).toEqual([
      "Create page: Gauss",
      "Create database: Exams with 2 properties and 1 starter row",
    ]);
  });

  it("pluralizes subpage and row previews", () => {
    const plan: AiActionPlan = {
      version: 1,
      summary: "Add structure.",
      requires_confirmation: true,
      actions: [
        {
          type: "create_subpages",
          parent_id: "page-1",
          pages: [{ title: "Chapter 1" }],
        },
        {
          type: "create_database_rows",
          database_page_id: "db-1",
          rows: [{ title: "Physics" }, { title: "Math" }],
        },
      ],
    };

    expect(formatAiActionPreview(plan)).toEqual([
      "Create 1 subpage under current page",
      "Create 2 database rows",
    ]);
  });

  it("auto-applies only create-only plans in trusted mode", () => {
    const safePlan: AiActionPlan = {
      version: 1,
      summary: "Create one page.",
      requires_confirmation: false,
      actions: [{ type: "create_page", title: "Safe" }],
    };

    const unsupportedPlan = {
      version: 1,
      summary: "Delete something.",
      requires_confirmation: false,
      actions: [{ type: "delete_page", id: "page" }],
    } as unknown as AiActionPlan;

    expect(canTrustedModeAutoApply(safePlan, true)).toBe(true);
    expect(canTrustedModeAutoApply(safePlan, false)).toBe(false);
    expect(canTrustedModeAutoApply(unsupportedPlan, true)).toBe(false);
  });
});
