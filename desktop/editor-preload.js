"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
    reactReady: () => ipcRenderer.send("botclient:editorReady"),
    closeWindow: () => ipcRenderer.send("botclient:editorClose"),
});

ipcRenderer.once("botclient:editor-port", event => {
    const port = event.ports[0];
    if (!port) return;
    window.postMessage("forward-editor-port", "*", [port]);
});