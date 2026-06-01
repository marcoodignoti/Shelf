import { describe, expect, it } from "vitest";
import {
  aiAppliedMessage,
  aiChatHistory,
  aiMissingKeyMessage,
  aiPlanMessages,
  trimmedAiPrompt,
  type AiChatMessage,
} from "./aiChat";
import { type AiActionPlan } from "./ai";

describe("AI chat helpers", () => {
  it("trims prompts before sending them to the provider", () => {
    expect(trimmedAiPrompt("  Create an exam tracker  \n")).toBe("Create an exam tracker");
    expect(trimmedAiPrompt("   ")).toBe("");
  });

  it("builds a user and assistant preview turn from an action plan", () => {
    const plan: AiActionPlan = {
      version: 1,
      summary: "Create an exam tracker.",
      requires_confirmation: true,
      actions: [
        {
          type: "create_database",
          title: "Exams",
          properties: [{ id: "status", name: "Status", type: "select", options: ["Todo", "Done"] }],
          starter_rows: [{ title: "Physics", properties: { status: "Todo" } }],
        },
      ],
    };

    expect(aiPlanMessages("Create exams", plan, "user-1", "assistant-1")).toEqual([
      {
        id: "user-1",
        role: "user",
        content: "Create exams",
      },
      {
        id: "assistant-1",
        role: "assistant",
        content: "Create an exam tracker.",
        previewLines: ["Create database: Exams with 1 property and 1 starter row"],
        kind: "preview",
      },
    ]);
  });

  it("uses concise assistant messages for missing keys and applied plans", () => {
    expect(aiMissingKeyMessage("missing")).toEqual({
      id: "missing",
      role: "assistant",
      content: "Add an OpenRouter API key in Settings before using AI.",
      kind: "notice",
    });
    expect(aiAppliedMessage(2, "applied")).toEqual({
      id: "applied",
      role: "assistant",
      content: "Applied 2 items.",
      kind: "applied",
    });
    expect(aiAppliedMessage(1, "applied-one").content).toBe("Applied 1 item.");
  });

  it("builds backend history from the transcript, dropping notices and blanks", () => {
    const messages: AiChatMessage[] = [
      { id: "u1", role: "user", content: "Create exams" },
      { id: "a1", role: "assistant", content: "Create an exam tracker.", kind: "preview" },
      { id: "n1", role: "assistant", content: "Add an OpenRouter API key.", kind: "notice" },
      { id: "u2", role: "user", content: "   " },
      { id: "a2", role: "assistant", content: "Created 1 item.", kind: "applied" },
    ];

    expect(aiChatHistory(messages)).toEqual([
      { role: "user", content: "Create exams" },
      { role: "assistant", content: "Create an exam tracker." },
      { role: "assistant", content: "Created 1 item." },
    ]);
  });
});
