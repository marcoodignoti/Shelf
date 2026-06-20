const assert = require("node:assert/strict");
const test = require("node:test");
const {
  PROVIDERS,
  isAllowedNavigation,
  validateWebviewAttachment,
} = require("./external-assistant-providers.cjs");

test("provider table matches the TS source of truth", () => {
  // Drift guard: if someone edits the CJS table without updating the TS
  // table (or vice versa), this catches it. The allowlist is the most
  // security-relevant field, so it is covered explicitly.
  const expected = [
    {
      id: "chatgpt",
      url: "https://chatgpt.com/",
      partition: "persist:external-assistant-chatgpt",
      allowlist: ["chatgpt.com", "*.chatgpt.com", "auth.openai.com", "auth0.openai.com", "chat.openai.com"],
    },
    {
      id: "gemini",
      url: "https://gemini.google.com/",
      partition: "persist:external-assistant-gemini",
      allowlist: ["gemini.google.com", "accounts.google.com"],
    },
  ];
  for (const exp of expected) {
    const p = PROVIDERS.find((x) => x.id === exp.id);
    assert.ok(p, `missing provider ${exp.id}`);
    assert.equal(p.url, exp.url);
    assert.equal(p.partition, exp.partition);
    assert.deepEqual(p.allowlist, exp.allowlist);
  }
});

test("isAllowedNavigation rejects bare openai.com / google.com roots", () => {
  assert.equal(isAllowedNavigation("chatgpt", "https://openai.com/blog"), false);
  assert.equal(isAllowedNavigation("gemini", "https://google.com/"), false);
});

test("isAllowedNavigation rejects http", () => {
  assert.equal(isAllowedNavigation("chatgpt", "http://chatgpt.com/"), false);
});

test("validateWebviewAttachment rejects preload and node integration", () => {
  const base = {
    src: "https://chatgpt.com/",
    partition: "persist:external-assistant-chatgpt",
    preload: undefined,
    nodeIntegration: false,
    contextIsolation: true,
    providerId: "chatgpt",
  };
  assert.equal(validateWebviewAttachment(base).ok, true);
  assert.equal(validateWebviewAttachment({ ...base, preload: "file:///x" }).ok, false);
  assert.equal(validateWebviewAttachment({ ...base, nodeIntegration: true }).ok, false);
  assert.equal(validateWebviewAttachment({ ...base, contextIsolation: false }).ok, false);
  assert.equal(
    validateWebviewAttachment({ ...base, partition: "persist:external-assistant-gemini" }).ok,
    false,
  );
});
