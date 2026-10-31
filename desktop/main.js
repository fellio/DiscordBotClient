"use strict";

const { app, BrowserWindow, Menu, MessageChannelMain, dialog, ipcMain, shell, session, systemPreferences } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const APP_NAME = "BotClient";
const APP_ID = "local.botclient.air";
const HOME_URL = "https://discord.com/channels/@me";
const LOGIN_URL = "https://discord.com/login";
const MODS = ["vencord", "equicord", "none"];
const MOD_LABELS = { vencord: "Vencord", equicord: "Equicord", none: "なし" };
const GUILDS_PER_SHARD = 1000;

const ALL_INTENTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 20, 21, 24, 25]
    .reduce((total, bit) => total + (2 ** bit), 0);
const APP_FLAG_PRESENCE = 1 << 12;
const APP_FLAG_PRESENCE_LIMITED = 1 << 13;
const APP_FLAG_GUILD_MEMBERS = 1 << 14;
const APP_FLAG_GUILD_MEMBERS_LIMITED = 1 << 15;
const APP_FLAG_MESSAGE_CONTENT = 1 << 18;
const APP_FLAG_MESSAGE_CONTENT_LIMITED = 1 << 19;

app.setName(APP_NAME);
app.setAppUserModelId(APP_ID);
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const userDataArg = process.argv.find(a => a.startsWith("--user-data-dir="));
if (userDataArg) app.setPath("userData", userDataArg.slice("--user-data-dir=".length));
const remoteDebugArg = process.argv.find(a => a.startsWith("--remote-debugging-port="));
if (remoteDebugArg) app.commandLine.appendSwitch("remote-debugging-port", remoteDebugArg.split("=")[1]);
const verbose = process.argv.includes("--verbose");

let mainWindow = null;
let editorWindow = null;
let settings = { clientMod: "vencord", zoom: 1 };
let settingsPath = "";
let modLoadError = null;

function log(...args) {
    console.log("[BotClient]", ...args);
}

function resourcesDir() {
    return app.isPackaged ? process.resourcesPath : __dirname;
}

function assetsDir() {
    return path.join(resourcesDir(), "assets");
}

function extensionsDir() {
    return path.join(resourcesDir(), "extensions");
}

function iconPath() {
    const icns = path.join(assetsDir(), "AppIcon.icns");
    if (fs.existsSync(icns)) return icns;
    return path.join(assetsDir(), "DiscordIcon.png");
}

function isDiscordUrl(value) {
    try {
        const { hostname } = new URL(value);
        return hostname === "discord.com" || hostname.endsWith(".discord.com");
    } catch {
        return false;
    }
}

function loadSettings() {
    settingsPath = path.join(app.getPath("userData"), "settings.json");
    try {
        Object.assign(settings, JSON.parse(fs.readFileSync(settingsPath, "utf8")));
    } catch {
        // first launch
    }
    const arg = process.argv.find(a => a.startsWith("--client-mod="));
    if (arg) {
        const mod = arg.split("=")[1];
        if (MODS.includes(mod)) settings.clientMod = mod;
    }
    if (!MODS.includes(settings.clientMod)) settings.clientMod = "vencord";
    if (typeof settings.zoom !== "number" || !Number.isFinite(settings.zoom)) settings.zoom = 1;
}

function saveSettings() {
    try {
        fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    } catch (error) {
        log("設定を保存できません:", error.message);
    }
}

function modAvailable(mod) {
    return mod === "none" || fs.existsSync(path.join(extensionsDir(), mod, "manifest.json"));
}

async function loadClientMod() {
    const mod = settings.clientMod;
    if (mod === "none") {
        log("クライアントMODなしで起動します。");
        return;
    }
    if (!modAvailable(mod)) {
        modLoadError = `${MOD_LABELS[mod]} 拡張が見つかりません: ${path.join(extensionsDir(), mod)}`;
        log(modLoadError);
        return;
    }
    try {
        const extension = await session.defaultSession.extensions.loadExtension(path.join(extensionsDir(), mod), {
            allowFileAccess: true,
        });
        log(`${MOD_LABELS[mod]} ${extension.version} を読み込みました。`);
    } catch (error) {
        modLoadError = `${MOD_LABELS[mod]} を読み込めませんでした: ${error.message}`;
        log(modLoadError);
    }
}

function configureSession(ses) {
    const discordUrls = ["https://discord.com/*", "https://*.discord.com/*"];
    const discordApiUrls = ["https://discord.com/api/*", "https://*.discord.com/api/*"];

    // Discord Web sends the raw token; the bot API expects the "Bot " scheme.
    // Discord rejects bot tokens carrying browser headers (40333 "internal network error"),
    // so auth'd API calls are normalized the same way DiscordBotClient's proxy does it.
    const botUserAgent = `DiscordBot (https://github.com/aiko-chan-ai/DiscordBotClient, v${app.getVersion()})`;
    ses.webRequest.onBeforeSendHeaders({ urls: discordApiUrls }, (details, callback) => {
        const headers = details.requestHeaders;
        const authKey = Object.keys(headers).find(key => key.toLowerCase() === "authorization");
        if (!authKey) return callback({ requestHeaders: headers });
        const value = String(headers[authKey] ?? "").trim();
        if (!value) return callback({ requestHeaders: headers });
        if (!/^(bot|bearer)\s/i.test(value)) headers[authKey] = `Bot ${value}`;

        const uaKey = Object.keys(headers).find(key => key.toLowerCase() === "user-agent");
        if (uaKey) headers[uaKey] = botUserAgent;
        else headers["User-Agent"] = botUserAgent;
        for (const key of Object.keys(headers)) {
            const lower = key.toLowerCase();
            if (lower === "origin" || lower === "referer" || lower === "cookie" || lower.startsWith("sec-")) {
                delete headers[key];
            }
        }
        callback({ requestHeaders: headers });
    });

    // Vencord / Equicord are built for a CSP-free Discord page.
    ses.webRequest.onHeadersReceived({ urls: discordUrls }, (details, callback) => {
        if (details.resourceType !== "mainFrame" && details.resourceType !== "subFrame") {
            return callback({ responseHeaders: details.responseHeaders });
        }
        const headers = { ...(details.responseHeaders || {}) };
        for (const key of Object.keys(headers)) {
            if (/^content-security-policy(-report-only)?$/i.test(key)) delete headers[key];
        }
        callback({ responseHeaders: headers });
    });

    const isTrustedMedia = value => {
        try {
            const { hostname } = new URL(value);
            return hostname === "discord.com" || hostname.endsWith(".discord.com");
        } catch {
            return false;
        }
    };

    ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
        const url = details.requestingUrl || webContents.getURL();
        if (!isTrustedMedia(url)) return callback(false);
        if (permission === "media") {
            const mediaTypes = details.mediaTypes || [];
            if (mediaTypes.includes("video")) return callback(false);
            systemPreferences
                .askForMediaAccess("microphone")
                .then(granted => callback(granted))
                .catch(() => callback(false));
            return;
        }
        if (permission === "notifications" || permission === "fullscreen" || permission === "clipboard-sanitized-write") {
            return callback(true);
        }
        return callback(false);
    });

    ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
        if (!isTrustedMedia(requestingOrigin)) return false;
        return ["media", "notifications", "fullscreen", "clipboard-sanitized-write"].includes(permission);
    });
}

function computeIntents(flags) {
    let intents = ALL_INTENTS;
    if (!(flags & (APP_FLAG_PRESENCE | APP_FLAG_PRESENCE_LIMITED))) intents &= ~(1 << 8);
    if (!(flags & (APP_FLAG_GUILD_MEMBERS | APP_FLAG_GUILD_MEMBERS_LIMITED))) intents &= ~(1 << 1);
    const messageContent = Boolean(flags & (APP_FLAG_MESSAGE_CONTENT | APP_FLAG_MESSAGE_CONTENT_LIMITED));
    if (!messageContent) intents &= ~(1 << 15);
    return { intents, messageContent };
}

async function getBotInfo(rawToken) {
    const token = String(rawToken || "").replace(/^bot\s+/i, "").trim();
    if (!token) return { success: false, message: "Bot token is empty" };
    try {
        const response = await session.defaultSession.fetch(
            "https://discord.com/api/v10/applications/@me?with_counts=true",
            {
                headers: {
                    Authorization: `Bot ${token}`,
                    "User-Agent": "DiscordBot (https://github.com/aiko-chan-ai/DiscordBotClient, v2.0.0)",
                },
            },
        );
        if (!response.ok) {
            let message = `${response.status} ${response.statusText}`.trim();
            try {
                const body = await response.json();
                if (body && body.message) message = `${response.status}: ${body.message}`;
            } catch {
                // ignore non-JSON error bodies
            }
            return { success: false, status: response.status, message };
        }
        const data = await response.json();
        const flags = Number(data.flags || 0);
        const { intents, messageContent } = computeIntents(flags);
        if (!messageContent) {
            return {
                success: false,
                message: "Message Content Intent が無効です。Discord Developer Portal で有効化してください。",
            };
        }
        const guildCount = Number(data.bot_approximate_guild_count ?? data.approximate_guild_count ?? 0) || 0;
        const allShards = Math.max(1, Math.ceil(guildCount / GUILDS_PER_SHARD));
        return { success: true, data, intents, allShards };
    } catch (error) {
        return { success: false, message: error.message };
    }
}

const EDITOR_ROOT = path.join(__dirname, "editor");
const EDITOR_MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json",
    ".map": "application/json; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
};
let editorServerPromise = null;

const EDITOR_CLOSE_CSS =
    "#bc-editor-close{margin-left:8px;flex:0 0 auto;width:32px;height:32px;display:flex;align-items:center;justify-content:center;border:0;border-radius:8px;background:transparent;color:#949ba4;cursor:pointer;}" +
    "#bc-editor-close:hover{background:#ed4245;color:#fff;}";
const EDITOR_CLOSE_JS = `(() => {
    if (window.__bcCloseInjected) return;
    window.__bcCloseInjected = true;
    const ensure = () => {
        if (document.getElementById("bc-editor-close")) return;
        const settings = Array.from(document.querySelectorAll("button")).find(b => b.textContent.trim() === "Settings");
        if (!settings || !settings.parentElement) return;
        const btn = document.createElement("button");
        btn.id = "bc-editor-close";
        btn.type = "button";
        btn.title = "閉じる";
        btn.setAttribute("aria-label", "閉じる");
        btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
        btn.addEventListener("click", () => window.electronAPI && window.electronAPI.closeWindow());
        settings.parentElement.appendChild(btn);
    };
    ensure();
    new MutationObserver(ensure).observe(document.body, { childList: true, subtree: true });
})();`;

// The bundled editor (aiko-chan-ai/discohook build) expects to be served over HTTP for its module/asset URLs.
function startEditorServer() {
    if (editorServerPromise) return editorServerPromise;
    editorServerPromise = new Promise((resolve, reject) => {
        const server = http.createServer(async (request, response) => {
            try {
                const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
                const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
                let filePath = path.join(EDITOR_ROOT, relative);
                if (!filePath.startsWith(EDITOR_ROOT + path.sep) && filePath !== path.join(EDITOR_ROOT, "index.html")) {
                    response.writeHead(403).end();
                    return;
                }
                let data;
                try {
                    data = await fs.promises.readFile(filePath);
                } catch {
                    filePath = path.join(EDITOR_ROOT, "index.html");
                    data = await fs.promises.readFile(filePath);
                }
                response.writeHead(200, {
                    "Content-Type": EDITOR_MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream",
                    "Cache-Control": "no-store",
                });
                response.end(data);
            } catch {
                response.writeHead(500).end();
            }
        });
        server.on("error", reject);
        server.listen(0, "127.0.0.1", () => resolve(server.address().port));
    });
    return editorServerPromise;
}

async function openMessageEditorWindow() {
    if (!mainWindow) return;
    if (editorWindow && !editorWindow.isDestroyed()) {
        editorWindow.show();
        editorWindow.focus();
        return;
    }
    let editorPort;
    try {
        editorPort = await startEditorServer();
    } catch (error) {
        dialog.showErrorBox("メッセージエディタ", `エディタの起動に失敗しました: ${error.message}`);
        return;
    }
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const win = new BrowserWindow({
        width: 1080,
        height: 720,
        minWidth: 800,
        minHeight: 600,
        parent: mainWindow,
        modal: true,
        title: "メッセージエディタ",
        backgroundColor: "#313338",
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, "editor-preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
        },
    });
    editorWindow = win;
    win.on("closed", () => {
        if (editorWindow === win) editorWindow = null;
    });
    win.webContents.on("did-finish-load", () => {
        win.webContents.insertCSS(EDITOR_CLOSE_CSS).catch(() => {});
        win.webContents.executeJavaScript(EDITOR_CLOSE_JS, true).catch(() => {});
    });
    win.loadURL(`http://127.0.0.1:${editorPort}/`);
}

function registerIpc() {
    ipcMain.handle("botclient:getBotInfo", (_event, token) => getBotInfo(token));
    ipcMain.handle("botclient:openMessageEditor", () => {
        openMessageEditorWindow();
        return null;
    });
    ipcMain.on("botclient:editorReady", event => {
        if (!editorWindow || editorWindow.isDestroyed() || event.sender !== editorWindow.webContents) return;
        if (!mainWindow || mainWindow.isDestroyed()) return;
        const { port1, port2 } = new MessageChannelMain();
        editorWindow.webContents.postMessage("botclient:editor-port", null, [port2]);
        mainWindow.webContents.postMessage("botclient:main-editor-port", null, [port1]);
    });
    ipcMain.on("botclient:editorClose", event => {
        if (editorWindow && !editorWindow.isDestroyed() && event.sender === editorWindow.webContents) {
            editorWindow.close();
        }
    });
    ipcMain.on("botclient:getVersion", event => {
        event.returnValue = app.getVersion();
    });
    ipcMain.on("botclient:getAppName", event => {
        event.returnValue = APP_NAME;
    });
    ipcMain.on("botclient:window", (event, action, _frameName, flag) => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win) return;
        switch (action) {
            case "close":
                win.close();
                break;
            case "minimize":
                win.minimize();
                break;
            case "maximize":
                if (win.isMaximized()) win.unmaximize();
                else win.maximize();
                break;
            case "focus":
                win.show();
                win.focus();
                break;
            case "flashFrame":
                win.flashFrame(Boolean(flag));
                break;
        }
    });
}

function relaunch() {
    app.relaunch();
    app.exit(0);
}

async function chooseClientMod(mod) {
    if (mod === settings.clientMod) return;
    if (mod !== "none" && !modAvailable(mod)) {
        dialog.showErrorBox("クライアントMOD", `${MOD_LABELS[mod]} 拡張が同梱されていません。`);
        return;
    }
    const choice = dialog.showMessageBoxSync(mainWindow, {
        type: "question",
        buttons: ["再起動", "キャンセル"],
        defaultId: 0,
        cancelId: 1,
        message: `${MOD_LABELS[mod]} に切り替えますか？`,
        detail: "クライアントMODの切り替えには再起動が必要です。",
    });
    if (choice !== 0) {
        buildMenu();
        return;
    }
    settings.clientMod = mod;
    saveSettings();
    relaunch();
}

async function logoutAndShowLogin() {
    if (!mainWindow) return;
    const choice = await dialog.showMessageBox(mainWindow, {
        type: "warning",
        buttons: ["ログアウト", "キャンセル"],
        defaultId: 1,
        cancelId: 1,
        message: "Botトークンを消去してログイン画面に戻りますか？",
    });
    if (choice.response !== 0) return;
    try {
        await mainWindow.webContents.executeJavaScript(
            '(() => { try { localStorage.removeItem("token"); localStorage.removeItem("tokens"); } catch {} return true; })()',
            true,
        );
    } catch {
        // ignore
    }
    mainWindow.loadURL(LOGIN_URL);
}

function showDiagnostics() {
    const status = modLoadError
        ? modLoadError
        : `${MOD_LABELS[settings.clientMod]} 読み込み済み`;
    dialog.showMessageBox(mainWindow, {
        type: modLoadError ? "error" : "info",
        message: "BotClient 診断",
        detail: [
            `バージョン: ${app.getVersion()}`,
            `クライアントMOD: ${MOD_LABELS[settings.clientMod]}`,
            `状態: ${status}`,
            `Electron: ${process.versions.electron}`,
            `Chromium: ${process.versions.chrome}`,
            `URL: ${mainWindow ? mainWindow.webContents.getURL() : "-"}`,
        ].join("\n"),
    });
}

function buildMenu() {
    const isMac = process.platform === "darwin";
    const modItems = MODS.map(mod => ({
        label: `${MOD_LABELS[mod]}${mod === "none" || modAvailable(mod) ? "" : "（未ビルド）"}`,
        type: "radio",
        checked: settings.clientMod === mod,
        click: () => chooseClientMod(mod),
    }));

    const template = [
        ...(isMac
            ? [
                  {
                      role: "appMenu",
                      submenu: [
                          { role: "about" },
                          { type: "separator" },
                          { label: "診断情報…", click: showDiagnostics },
                          { type: "separator" },
                          { role: "hide" },
                          { role: "hideOthers" },
                          { role: "unhide" },
                          { type: "separator" },
                          { role: "quit", label: "BotClient を終了" },
                      ],
                  },
              ]
            : []),
        {
            label: "クライアント",
            submenu: [
                {
                    label: "Discordを再読み込み",
                    accelerator: "CmdOrCtrl+R",
                    click: () => mainWindow && mainWindow.webContents.reload(),
                },
                {
                    label: "ログイン画面を開く",
                    accelerator: "CmdOrCtrl+Shift+L",
                    click: () => mainWindow && mainWindow.loadURL(LOGIN_URL),
                },
                {
                    label: "トークンを消去してログアウト",
                    click: logoutAndShowLogin,
                },
                { type: "separator" },
                { label: "クライアントMOD", submenu: modItems },
                { label: "再起動", accelerator: "CmdOrCtrl+Shift+M", click: relaunch },
                { type: "separator" },
                { role: "toggleDevTools", label: "開発者ツール" },
                { role: "togglefullscreen", label: "フルスクリーン" },
                ...(isMac ? [] : [{ type: "separator" }, { role: "quit", label: "終了" }]),
            ],
        },
        { role: "editMenu", label: "編集" },
        {
            label: "表示",
            submenu: [
                { role: "resetZoom", label: "実際のサイズ" },
                { role: "zoomIn", label: "拡大" },
                { role: "zoomOut", label: "縮小" },
            ],
        },
        { role: "windowMenu", label: "ウインドウ" },
        {
            role: "help",
            label: "ヘルプ",
            submenu: [
                { label: "BotClient 診断…", click: showDiagnostics },
                { type: "separator" },
                {
                    label: "Discord Developer Portal",
                    click: () => shell.openExternal("https://discord.com/developers/applications"),
                },
                { label: "Vencord", click: () => shell.openExternal("https://github.com/Vendicated/Vencord") },
                { label: "Equicord", click: () => shell.openExternal("https://github.com/equicord/equicord") },
                {
                    label: "DiscordBotClient",
                    click: () => shell.openExternal("https://github.com/aiko-chan-ai/DiscordBotClient"),
                },
            ],
        },
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
    const win = new BrowserWindow({
        width: 1280,
        height: 820,
        minWidth: 940,
        minHeight: 520,
        title: APP_NAME,
        backgroundColor: "#313338",
        icon: iconPath(),
        show: false,
        titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
        trafficLightPosition: { x: 10, y: 12 },
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false,
            spellcheck: true,
            backgroundThrottling: false,
            webSecurity: false,
        },
    });
    mainWindow = win;

    win.once("ready-to-show", () => win.show());
    win.on("closed", () => {
        mainWindow = null;
        if (editorWindow && !editorWindow.isDestroyed()) editorWindow.close();
    });

    win.webContents.setWindowOpenHandler(({ url }) => {
        if (url === "about:blank" || isDiscordUrl(url)) {
            return {
                action: "allow",
                overrideBrowserWindowOptions: {
                    autoHideMenuBar: true,
                    width: 1080,
                    height: 720,
                    webPreferences: {
                        preload: path.join(__dirname, "preload.js"),
                        contextIsolation: true,
                        nodeIntegration: false,
                        sandbox: false,
                        webSecurity: false,
                    },
                },
            };
        }
        if (/^https?:\/\//i.test(url)) shell.openExternal(url);
        return { action: "deny" };
    });

    win.webContents.on("will-navigate", (event, url) => {
        if (isDiscordUrl(url) || url.startsWith("chrome-extension://")) return;
        event.preventDefault();
        if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    });

    win.webContents.on("did-finish-load", () => {
        log("Discord Web UI を読み込みました。");
        if (typeof settings.zoom === "number" && settings.zoom !== 1) {
            win.webContents.setZoomFactor(settings.zoom);
        }
        // On macOS the hidden-inset traffic lights overlap Discord's back/forward
        // buttons; shift that group to the right of the window controls.
        if (process.platform === "darwin") {
            win.webContents
                .insertCSS('[class*="backForwardButtons"]{margin-left:76px;}')
                .catch(() => {});
        }
    });

    if (verbose) {
        win.webContents.on("console-message", (...args) => {
            const details = args[1] && typeof args[1] === "object" ? args[1] : null;
            const message = details ? details.message : args[2];
            if (!message) return;
            log("renderer:", String(message).replace(/\s+/g, " ").slice(0, 1200));
        });
    }

    win.webContents.on("render-process-gone", (_event, details) => {
        log("レンダラープロセスが終了しました:", details.reason);
    });

    win.loadURL(HOME_URL);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on("second-instance", () => {
        if (!mainWindow) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
    });

    app.whenReady().then(async () => {
        loadSettings();
        if (process.platform === "darwin" && app.dock) {
            app.dock.setIcon(path.join(assetsDir(), "DiscordIcon.png"));
        }
        configureSession(session.defaultSession);
        await loadClientMod();
        registerIpc();
        buildMenu();
        createWindow();
        if (modLoadError) {
            dialog.showMessageBox(mainWindow, {
                type: "error",
                message: "クライアントMODを読み込めませんでした",
                detail: modLoadError,
            });
        }
        log(`起動しました (MOD: ${MOD_LABELS[settings.clientMod]}, v${app.getVersion()})`);

        app.on("activate", () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
        });
    });

    app.on("window-all-closed", () => app.quit());
}
