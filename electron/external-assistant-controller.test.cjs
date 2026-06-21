const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { createExternalAssistantController } = require("./external-assistant.cjs");

class FakeWebContents extends EventEmitter {
  constructor(session) {
    super();
    this.session = session;
    this.windowOpenHandler = null;
    this.loadedUrls = [];
  }

  setWindowOpenHandler(handler) {
    this.windowOpenHandler = handler;
  }

  loadURL(url) {
    this.loadedUrls.push(url);
    return Promise.resolve();
  }
}

function createHarness() {
  const metadata = new Map();
  const sessions = new Map();
  const openedExternal = [];
  const windows = [];
  const handlers = new Map();

  class FakeBrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.visible = false;
      this.destroyed = false;
      this.focused = false;
      this.position = [options.x ?? 0, options.y ?? 0];
      this.size = [options.width ?? 420, options.height ?? 640];
      this.webContents = new FakeWebContents(
        options.webPreferences?.partition
          ? sessions.get(options.webPreferences.partition)
          : { partition: "window" },
      );
      windows.push(this);
    }

    loadURL(url) {
      return this.webContents.loadURL(url);
    }

    show() {
      this.visible = true;
    }

    showInactive() {
      this.visible = true;
    }

    hide() {
      this.visible = false;
    }

    focus() {
      this.focused = true;
      this.emit("focus");
    }

    isFocused() {
      return this.focused;
    }

    isVisible() {
      return this.visible;
    }

    isDestroyed() {
      return this.destroyed;
    }

    destroy() {
      this.destroyed = true;
      this.emit("closed");
    }

    setAlwaysOnTop() {}

    getPosition() {
      return this.position;
    }

    getSize() {
      return this.size;
    }
  }

  const mainWindow = new EventEmitter();
  mainWindow.getSize = () => [1280, 860];
  mainWindow.getPosition = () => [0, 0];
  mainWindow.isDestroyed = () => false;
  mainWindow.focused = true;
  mainWindow.isFocused = () => mainWindow.focused;

  const controller = createExternalAssistantController({
    getMainWindow: () => mainWindow,
    backend: {
      readMetadataValue: (key) => metadata.get(key) ?? null,
      writeMetadataValue: (key, value) => metadata.set(key, value),
    },
    electron: {
      BrowserWindow: FakeBrowserWindow,
      ipcMain: {
        handle: (channel, handler) => handlers.set(channel, handler),
        on: (channel, handler) => handlers.set(channel, handler),
      },
      session: {
        fromPartition: (partition) => {
          if (!sessions.has(partition)) {
            const providerSession = new EventEmitter();
            providerSession.partition = partition;
            sessions.set(partition, providerSession);
          }
          return sessions.get(partition);
        },
      },
      shell: {
        openExternal: (url) => {
          openedExternal.push(url);
          return Promise.resolve("");
        },
      },
    },
  });

  return { controller, mainWindow, metadata, sessions, openedExternal, windows, handlers };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("controller persists provider state through backend metadata hooks", () => {
  const { controller, metadata } = createHarness();

  controller._internal.show("gemini");

  const state = JSON.parse(metadata.get("external_assistant_state"));
  assert.equal(state.provider, "gemini");
  assert.equal(controller._internal.readState().provider, "gemini");
});

test("user close hides the child window, destroy closes it for app shutdown", () => {
  const { controller, windows } = createHarness();
  const win = controller._internal.ensureWindow();

  let prevented = false;
  win.emit("close", { preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(win.isDestroyed(), false);

  controller.destroy();
  assert.equal(windows[0].isDestroyed(), true);

  const reopened = controller._internal.ensureWindow();
  prevented = false;
  reopened.emit("close", { preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(reopened.isDestroyed(), false);
});

test("allowlisted webview popups open in provider partition; other popups go external", () => {
  const { controller, sessions, openedExternal, windows } = createHarness();
  const win = controller._internal.ensureWindow();
  const webviewContents = new FakeWebContents(sessions.get("persist:external-assistant-chatgpt"));

  win.webContents.emit("did-attach-webview", {}, webviewContents);
  assert.ok(webviewContents.windowOpenHandler);

  assert.deepEqual(
    webviewContents.windowOpenHandler({ url: "https://chatgpt.com/g/g-abc/project" }),
    { action: "deny" },
  );
  assert.deepEqual(webviewContents.loadedUrls, ["https://chatgpt.com/g/g-abc/project"]);
  assert.equal(windows.length, 1);

  assert.deepEqual(
    webviewContents.windowOpenHandler({ url: "https://auth.openai.com/login" }),
    { action: "deny" },
  );
  assert.equal(windows.length, 2);
  assert.equal(
    windows[1].options.webPreferences.partition,
    "persist:external-assistant-chatgpt",
  );

  assert.deepEqual(
    webviewContents.windowOpenHandler({ url: "https://accounts.google.com/o/oauth2/v2/auth" }),
    { action: "deny" },
  );
  assert.equal(windows.length, 3);
  assert.equal(
    windows[2].options.webPreferences.partition,
    "persist:external-assistant-chatgpt",
  );

  webviewContents.windowOpenHandler({ url: "https://example.com/" });
  assert.deepEqual(openedExternal, ["https://example.com/"]);
});

test("provider sessions select the first WebAuthn account for passkey auth", () => {
  const { controller, sessions } = createHarness();
  controller.init();
  const chatgptSession = sessions.get("persist:external-assistant-chatgpt");

  let selectedCredential = "not-called";
  chatgptSession.emit(
    "select-webauthn-account",
    {},
    {
      relyingPartyId: "accounts.google.com",
      accounts: [
        { credentialId: "credential-1", name: "marco@example.com" },
        { credentialId: "credential-2", name: "other@example.com" },
      ],
    },
    (credentialId) => { selectedCredential = credentialId; },
  );

  assert.equal(selectedCredential, "credential-1");
});

test("main-window blur does not hide chat while the chat window is focused", async () => {
  const { controller, mainWindow, windows } = createHarness();
  controller.init();
  controller._internal.show();

  const win = windows[0];
  assert.equal(win.isVisible(), true);

  mainWindow.focused = false;
  mainWindow.emit("blur");
  win.focused = true;
  win.emit("focus");
  await wait(120);
  assert.equal(win.isVisible(), true);
});

test("main-window blur hides chat when neither Shelf nor chat is focused", async () => {
  const { controller, mainWindow, windows } = createHarness();
  controller.init();
  controller._internal.show();

  const win = windows[0];
  win.focused = false;
  mainWindow.focused = false;
  assert.equal(win.isVisible(), true);

  mainWindow.emit("blur");
  await wait(120);
  assert.equal(win.isVisible(), false);
});
