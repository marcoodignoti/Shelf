const { contextBridge, ipcRenderer } = require("electron");
const { pathToFileURL } = require("node:url");

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeArgs(args) {
  return isRecord(args) ? args : {};
}

contextBridge.exposeInMainWorld("openNotion", {
  invoke(command, args) {
    if (typeof command !== "string") throw new Error("command must be a string");
    return ipcRenderer.invoke("opennotion:invoke", { command, args: normalizeArgs(args) });
  },
  open(options) {
    return ipcRenderer.invoke("opennotion:dialog-open", isRecord(options) ? options : {});
  },
  save(options) {
    return ipcRenderer.invoke("opennotion:dialog-save", isRecord(options) ? options : {});
  },
  fileSrc(filePath) {
    if (typeof filePath !== "string") throw new Error("file path must be a string");
    return pathToFileURL(filePath).toString();
  },
});
