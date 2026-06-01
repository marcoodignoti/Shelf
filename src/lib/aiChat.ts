import { AiActionPlan, AiChatTurn, formatAiActionPreview } from "./ai";

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

// Turn the visible chat transcript into role/content turns for the backend so a
// follow-up prompt ("make it longer", "now add a column") has prior context.
// "notice" messages (e.g. missing-key warnings) are local UI chatter, not part
// of the model conversation, so they are dropped.
export function aiChatHistory(messages: AiChatMessage[]): AiChatTurn[] {
  return messages
    .filter((message) => message.kind !== "notice" && message.content.trim().length > 0)
    .map((message) => ({ role: message.role, content: message.content }));
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

export function aiAppliedMessage(changedCount: number, id: string): AiChatMessage {
  const itemLabel = changedCount === 1 ? "item" : "items";
  return {
    id,
    role: "assistant",
    content: `Applied ${changedCount} ${itemLabel}.`,
    kind: "applied",
  };
}
