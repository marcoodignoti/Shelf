import { AiActionPlan, formatAiActionPreview } from "./ai";

export type AiChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  previewLines?: string[];
  kind?: "notice" | "preview" | "applied";
};

export function trimmedAiPrompt(value: string): string {
  return value.trim();
}

export function aiPlanMessages(
  prompt: string,
  plan: AiActionPlan,
  userId: string,
  assistantId: string
): AiChatMessage[] {
  return [
    {
      id: userId,
      role: "user",
      content: prompt,
    },
    {
      id: assistantId,
      role: "assistant",
      content: plan.summary,
      previewLines: formatAiActionPreview(plan),
      kind: "preview",
    },
  ];
}

export function aiMissingKeyMessage(id: string): AiChatMessage {
  return {
    id,
    role: "assistant",
    content: "Add an OpenRouter API key in Settings before using AI.",
    kind: "notice",
  };
}

export function aiAppliedMessage(createdCount: number, id: string): AiChatMessage {
  const itemLabel = createdCount === 1 ? "item" : "items";
  return {
    id,
    role: "assistant",
    content: `Created ${createdCount} ${itemLabel}.`,
    kind: "applied",
  };
}
