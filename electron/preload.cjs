const { contextBridge, ipcRenderer } = require("electron");

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeArgs(args) {
  return isRecord(args) ? args : {};
}

function filePathToUrl(filePath) {
  const result = ipcRenderer.sendSync("opennotion:file-src", filePath);
  if (!result || result.ok !== true || typeof result.value !== "string") {
    throw new Error(result?.error || "failed to create file URL");
  }
  return result.value;
}

function studioPdfUrl(documentId) {
  const result = ipcRenderer.sendSync("opennotion:studio-pdf-src", documentId);
  if (!result || result.ok !== true || typeof result.value !== "string") {
    throw new Error(result?.error || "failed to create Studio PDF URL");
  }
  return result.value;
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
  studioPdfSrc(documentId) {
    if (typeof documentId !== "string" || documentId.trim() === "") {
      throw new Error("document id must be a string");
    }
    return studioPdfUrl(documentId);
  },
});
