const { contextBridge, ipcRenderer } = require("electron");

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeArgs(args) {
  return isRecord(args) ? args : {};
}

function filePathToUrl(filePath) {
  const normalized = filePath.replace(/\\/g, "/");
  const encodedPath = normalized.split("/").map((part) => encodeURIComponent(part)).join("/");
  return normalized.startsWith("/") ? `file://${encodedPath}` : `file:///${encodedPath}`;
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
    return filePathToUrl(filePath);
  },
});
