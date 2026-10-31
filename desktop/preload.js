"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const PLACEHOLDER_USER = {
    id: "1000000000000000000",
    username: "botclient",
    global_name: "BotClient",
    discriminator: "0000",
    avatar: null,
    avatar_decoration: null,
    public_flags: 0,
    flags: 0,
    bot: true,
    system: true,
    banner: null,
    accent_color: null,
};

contextBridge.exposeInMainWorld("BotClientNative", {
    getBotInfo: token => ipcRenderer.invoke("botclient:getBotInfo", token),
    getBotClientVersion: () => ipcRenderer.sendSync("botclient:getVersion"),
    getBotClientName: () => ipcRenderer.sendSync("botclient:getAppName"),
    getPrivateChannelDefault: () => ({
        type: 1,
        recipients: [PLACEHOLDER_USER],
        last_message_id: "1000000000000000000",
        is_spam: false,
        id: "1000000000000000000",
        flags: 0,
    }),
    getUserExperiments: () => [],
    getGuildExperiments: () => [],
    getApexExperiments: () => ({ assignments: {} }),
    closeWindow: () => ipcRenderer.send("botclient:window", "close"),
    close: frameName => ipcRenderer.send("botclient:window", "close", frameName),
    minimize: frameName => ipcRenderer.send("botclient:window", "minimize", frameName),
    maximize: frameName => ipcRenderer.send("botclient:window", "maximize", frameName),
    focus: frameName => ipcRenderer.send("botclient:window", "focus", frameName),
    flashFrame: flag => ipcRenderer.send("botclient:window", "flashFrame", null, Boolean(flag)),
    requestOpenMessageEditorWindow: () => ipcRenderer.invoke("botclient:openMessageEditor"),
});

ipcRenderer.on("botclient:main-editor-port", event => {
    const port = event.ports[0];
    if (!port) return;
    window.postMessage("forward-editor-port", "*", [port]);
});

contextBridge.exposeInMainWorld("protoAPI", {
    GetPreloadedUserSettings: listener =>
        ipcRenderer.on("botclient:proto:getPreloadedUserSettings", (_event, botId) => listener(botId)),
    GetPreloadedUserSettingsResponse: (botId, settings) =>
        ipcRenderer.send("botclient:proto:getPreloadedUserSettingsResponse", botId, settings),
    SetPreloadedUserSettings: listener =>
        ipcRenderer.on("botclient:proto:setPreloadedUserSettings", (_event, botId, settings) => listener(botId, settings)),
    GetFrecencyUserSettings: listener =>
        ipcRenderer.on("botclient:proto:getFrecencyUserSettings", (_event, botId) => listener(botId)),
    GetFrecencyUserSettingsResponse: (botId, settings) =>
        ipcRenderer.send("botclient:proto:getFrecencyUserSettingsResponse", botId, settings),
    SetFrecencyUserSettings: listener =>
        ipcRenderer.on("botclient:proto:setFrecencyUserSettings", (_event, botId, settings) => listener(botId, settings)),
});
