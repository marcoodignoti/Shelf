const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("backend command registry groups renderer commands by domain and binds handlers", async () => {
  const { createBackendCommandRegistry } = require("./backend-command-registry.cjs");
  const calls = [];
  const backend = new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== "string") return undefined;
        return (args) => {
          calls.push([prop, args]);
          return `${prop}:result`;
        };
      },
    },
  );

  const commands = createBackendCommandRegistry(backend);

  assert.equal(commands.list_pages({ marker: "page" }), "listPages:result");
  assert.equal(
    commands.list_studio_documents({ marker: "studio" }),
    "listStudioDocuments:result",
  );
  assert.equal(
    commands.get_workspace_profile({ marker: "profile" }),
    "getWorkspaceProfile:result",
  );
  assert.equal(
    commands.fetch_update_manifest({ marker: "update" }),
    "fetchUpdateManifest:result",
  );
  assert.equal(commands.show_character_palette(), null);
  assert.deepEqual(calls, [
    ["listPages", { marker: "page" }],
    ["listStudioDocuments", { marker: "studio" }],
    ["getWorkspaceProfile", { marker: "profile" }],
    ["fetchUpdateManifest", { marker: "update" }],
  ]);
});

test("backend command registry exposes every typed renderer command and no extras", () => {
  const { createBackendCommandRegistry } = require("./backend-command-registry.cjs");
  const desktopCommandsPath = path.join(
    __dirname,
    "..",
    "src",
    "lib",
    "desktopCommands.ts",
  );
  const desktopCommandsSource = fs.readFileSync(desktopCommandsPath, "utf8");
  const commandArrayMatch = desktopCommandsSource.match(
    /export const DESKTOP_COMMAND_NAMES = \[([\s\S]*?)\] as const;/,
  );

  assert.ok(commandArrayMatch, "DESKTOP_COMMAND_NAMES array should be parseable");

  const typedCommandNames = [...commandArrayMatch[1].matchAll(/"([^"]+)"/g)]
    .map((match) => match[1])
    .sort();
  const registryCommandNames = Object.keys(
    createBackendCommandRegistry(
      new Proxy(
        {},
        {
          get() {
            return () => null;
          },
        },
      ),
    ),
  ).sort();

  assert.deepEqual(registryCommandNames, typedCommandNames);
});
