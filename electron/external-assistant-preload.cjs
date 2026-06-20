const { contextBridge, ipcRenderer } = require("electron");

// Minimal surface for the popover shell. Deliberately does NOT expose
// invoke/fileSrc/any Shelf data. The popover can only: read its initial
// provider, persist a provider choice, and ask to close itself.
contextBridge.exposeInMainWorld("externalAssistantShell", {
  getInitialState: () => ipcRenderer.invoke("external-assistant:get-state"),
  setProvider: (provider) =>
    ipcRenderer.invoke("external-assistant:set-provider", provider),
  close: () => ipcRenderer.send("external-assistant:close"),
});
