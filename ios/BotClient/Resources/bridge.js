(() => {
    "use strict";
    if (window.__bcBridgeInstalled) return;
    window.__bcBridgeInstalled = true;

    const BOT_USER_AGENT = "DiscordBot (https://github.com/aiko-chan-ai/DiscordBotClient, v2.0.0)";
    const GUILDS_PER_SHARD = 1000;
    const ALL_INTENTS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 20, 21, 24, 25]
        .reduce((total, bit) => total + (2 ** bit), 0);
    const APP_FLAG_PRESENCE = 1 << 12;
    const APP_FLAG_PRESENCE_LIMITED = 1 << 13;
    const APP_FLAG_GUILD_MEMBERS = 1 << 14;
    const APP_FLAG_GUILD_MEMBERS_LIMITED = 1 << 15;
    const APP_FLAG_MESSAGE_CONTENT = 1 << 18;
    const APP_FLAG_MESSAGE_CONTENT_LIMITED = 1 << 19;

    const nativeAPI = window.webkit?.messageHandlers?.bcApi ?? null;
    const nativeLog = window.webkit?.messageHandlers?.bcLog ?? null;

    function debug(...parts) {
        try {
            nativeLog?.postMessage(parts.map(part => typeof part === "string" ? part : JSON.stringify(part)).join(" "));
        } catch {
            // logging must never break the page
        }
    }

    debug("bridge: installed");

    try {
        let mediaDevices = navigator.mediaDevices;
        if (!mediaDevices) {
            mediaDevices = {
                getUserMedia: () => Promise.reject(new DOMException("getUserMedia is not supported", "NotSupportedError")),
                enumerateDevices: () => Promise.resolve([]),
                addEventListener: () => {},
                removeEventListener: () => {},
            };
            Object.defineProperty(navigator, "mediaDevices", { value: mediaDevices, configurable: true });
            debug("shim: mediaDevices stub installed");
        }
        if (!mediaDevices.getDisplayMedia) {
            Object.defineProperty(mediaDevices, "getDisplayMedia", {
                value: () => Promise.reject(new DOMException("getDisplayMedia is not supported on iOS", "NotSupportedError")),
                configurable: true,
                writable: true,
            });
        }
    } catch (error) {
        debug(`shim: mediaDevices failed ${error?.message || error}`);
    }

    function formatLogValue(value) {
        if (value instanceof Error) return `${value.name}: ${value.message} ${value.stack || ""}`;
        if (typeof value === "object" && value !== null) {
            try {
                return JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item);
            } catch {
                return String(value);
            }
        }
        return String(value);
    }

    for (const level of ["error", "warn"]) {
        const original = console[level].bind(console);
        console[level] = (...args) => {
            try {
                nativeLog?.postMessage(`console.${level}: ${args.map(formatLogValue).join(" ").slice(0, 1500)}`);
            } catch {
                // logging must never break the page
            }
            original(...args);
        };
    }

    if (window.__bcDebugLogs) {
        let forwardedLogs = 0;
        const originalLog = console.log.bind(console);
        console.log = (...args) => {
            if (forwardedLogs < 200) {
                forwardedLogs += 1;
                try {
                    nativeLog?.postMessage(`console.log: ${args.map(formatLogValue).join(" ").slice(0, 1000)}`);
                } catch {
                    // logging must never break the page
                }
            }
            originalLog(...args);
        };
    }

    for (const name of ["setAppBadge", "clearAppBadge"]) {
        if (typeof navigator[name] !== "function") {
            Object.defineProperty(navigator, name, { value: () => Promise.resolve(), configurable: true });
        }
    }

    function encodeBase64(bytes) {
        let binary = "";
        const chunk = 0x8000;
        for (let index = 0; index < bytes.length; index += chunk) {
            binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk));
        }
        return btoa(binary);
    }

    function decodeBase64(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        return bytes;
    }

    function headerEntries(input) {
        const headers = {};
        if (!input) return headers;
        if (typeof Headers !== "undefined" && input instanceof Headers) {
            input.forEach((value, key) => {
                headers[key] = value;
            });
        } else if (Array.isArray(input)) {
            for (const pair of input) {
                if (pair && pair.length === 2) headers[String(pair[0])] = String(pair[1]);
            }
        } else if (typeof input === "object") {
            for (const key of Object.keys(input)) {
                if (input[key] != null) headers[key] = String(input[key]);
            }
        }
        return headers;
    }

    function hasHeader(headers, name) {
        return Object.keys(headers).some(key => key.toLowerCase() === name);
    }

    function setHeader(headers, name, value) {
        for (const key of Object.keys(headers)) {
            if (key.toLowerCase() === name) delete headers[key];
        }
        headers[name] = value;
    }

    async function readBodyBytes(body) {
        if (body == null) return null;
        if (typeof body === "string") return new TextEncoder().encode(body);
        if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
            return new TextEncoder().encode(body.toString());
        }
        if (body instanceof ArrayBuffer) return new Uint8Array(body);
        if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
        if (typeof Blob !== "undefined" && body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
        throw new TypeError("unsupported request body");
    }

    async function sendNative(url, method, headers, bodyBytes) {
        if (!nativeAPI) throw new TypeError("native bridge unavailable");
        try {
            const path = new URL(url, location.href).pathname;
            if (window.__bcBotToken && path.startsWith("/api/") && !path.startsWith("/api/v10/auth/") && !hasHeader(headers, "authorization")) {
                headers.Authorization = `Bot ${window.__bcBotToken}`;
            }
        } catch {
            // header injection is best-effort
        }
        let reply;
        try {
            reply = await nativeAPI.postMessage({
                url,
                method,
                headers,
                body: bodyBytes ? encodeBase64(bodyBytes) : null,
            });
        } catch (error) {
            throw new TypeError(`native request failed: ${error?.message || error}`);
        }
        if (!reply || reply.error) throw new TypeError(reply?.error || "native request failed");
        const status = Number(reply.status) || 200;
        const bytes = reply.body ? decodeBase64(reply.body) : new Uint8Array();
        const responseBody = status === 204 || status === 205 || status === 304 ? null : bytes;
        return new Response(responseBody, {
            status,
            statusText: reply.statusText || "",
            headers: reply.headers || {},
        });
    }

    const NativeWebSocket = window.WebSocket;
    if (typeof NativeWebSocket === "function") {
        window.WebSocket = new Proxy(NativeWebSocket, {
            construct(target, args) {
                const socket = Reflect.construct(target, args);
                const url = String(args[0] || "");
                if (!/gateway\.discord\.gg/.test(url)) return socket;
                const nativeSend = socket.send.bind(socket);
                socket.send = data => {
                    if (typeof data === "string") {
                        try {
                            const payload = JSON.parse(data);
                            if (payload?.op === 2 && payload.d) {
                                const meta = window.__bcBotMeta;
                                if (meta) {
                                    const shard = Math.min(
                                        Number(localStorage.getItem("currentShard") || 0) || 0,
                                        Math.max(0, meta.allShards - 1),
                                    );
                                    payload.d.intents = meta.intents;
                                    payload.d.shard = [shard, meta.allShards];
                                    data = JSON.stringify(payload);
                                    debug(`gateway: identify intents=${meta.intents} shard=${shard}/${meta.allShards}`);
                                } else {
                                    debug(`gateway: identify without bot meta intents=${payload.d.intents}`);
                                }
                            }
                        } catch {
                            // non-JSON gateway payload
                        }
                    }
                    return nativeSend(data);
                };
                return socket;
            },
        });
    }

    function installXHRBridge() {
        const NativeXHR = window.XMLHttpRequest;
        if (typeof NativeXHR !== "function" || !nativeAPI) return;
        const API_PREFIX = /^https:\/\/discord\.com\/api\//;

        window.XMLHttpRequest = new Proxy(NativeXHR, {
            construct(target, args) {
                const xhr = Reflect.construct(target, args);
                const nativeOpen = xhr.open.bind(xhr);
                const nativeSend = xhr.send.bind(xhr);
                const nativeSetRequestHeader = xhr.setRequestHeader.bind(xhr);
                const nativeAbort = xhr.abort.bind(xhr);
                const nativeGetResponseHeader = xhr.getResponseHeader.bind(xhr);
                const nativeGetAllResponseHeaders = xhr.getAllResponseHeaders.bind(xhr);

                let intercepted = false;
                let method = "GET";
                let url = "";
                let sent = false;
                let aborted = false;
                let responseType = "";
                let readyState = 0;
                let status = 0;
                let statusText = "";
                let responseText = "";
                let response = null;
                let responseURL = "";
                let requestHeaders = {};
                let responseHeaders = {};

                const define = (name, descriptor) => {
                    try {
                        Object.defineProperty(xhr, name, { configurable: true, ...descriptor });
                    } catch (error) {
                        debug(`xhr: override ${name} failed ${error?.message || error}`);
                    }
                };
                const fire = (type, EventType = Event) => {
                    try {
                        xhr.dispatchEvent(new EventType(type));
                    } catch {
                        // event dispatch must never break the page
                    }
                };
                const updateReadyState = value => {
                    readyState = value;
                    fire("readystatechange");
                };

                define("readyState", { get: () => readyState });
                define("status", { get: () => status });
                define("statusText", { get: () => statusText });
                define("responseURL", { get: () => responseURL });
                define("responseText", { get: () => responseText });
                define("response", { get: () => response });
                define("responseXML", { get: () => null });
                define("responseType", {
                    get: () => responseType,
                    set: value => {
                        responseType = String(value || "");
                    },
                });
                define("open", {
                    value: function (nextMethod, nextURL, isAsync = true) {
                        method = String(nextMethod || "GET").toUpperCase();
                        url = String(nextURL || "");
                        intercepted = false;
                        try {
                            intercepted = API_PREFIX.test(new URL(url, location.href).href) && isAsync !== false;
                        } catch {
                            intercepted = false;
                        }
                        if (!intercepted) return nativeOpen(nextMethod, nextURL, isAsync);
                        updateReadyState(1);
                        return undefined;
                    },
                });
                define("setRequestHeader", {
                    value: function (name, value) {
                        if (!intercepted) return nativeSetRequestHeader(name, value);
                        if (!name) return undefined;
                        const lower = String(name).toLowerCase();
                        for (const key of Object.keys(requestHeaders)) {
                            if (key.toLowerCase() === lower) delete requestHeaders[key];
                        }
                        requestHeaders[String(name)] = String(value);
                        return undefined;
                    },
                });
                define("getResponseHeader", {
                    value: function (name) {
                        if (!intercepted) return nativeGetResponseHeader(name);
                        const lower = String(name).toLowerCase();
                        for (const key of Object.keys(responseHeaders)) {
                            if (key.toLowerCase() === lower) return String(responseHeaders[key]);
                        }
                        return null;
                    },
                });
                define("getAllResponseHeaders", {
                    value: function () {
                        if (!intercepted) return nativeGetAllResponseHeaders();
                        return Object.keys(responseHeaders)
                            .map(key => `${key}: ${responseHeaders[key]}`)
                            .join("\r\n");
                    },
                });
                define("abort", {
                    value: function () {
                        if (!intercepted) return nativeAbort();
                        aborted = true;
                        status = 0;
                        statusText = "";
                        updateReadyState(0);
                        fire("abort", ProgressEvent);
                        fire("loadend", ProgressEvent);
                        return undefined;
                    },
                });
                define("send", {
                    value: function (body) {
                        if (!intercepted) return nativeSend(body);
                        if (sent) throw new DOMException("XMLHttpRequest has already been sent", "InvalidStateError");
                        sent = true;
                        aborted = false;
                        updateReadyState(2);
                        (async () => {
                            try {
                                const bytes = await readBodyBytes(body);
                                const absoluteURL = new URL(url, location.href).href;
                                const reply = await nativeAPI.postMessage({
                                    url: absoluteURL,
                                    method,
                                    headers: requestHeaders,
                                    body: bytes ? encodeBase64(bytes) : null,
                                });
                                if (aborted) return;
                                if (!reply || reply.error) throw new Error(reply?.error || "native request failed");
                                status = Number(reply.status) || 200;
                                statusText = reply.statusText || "";
                                responseURL = reply.url || absoluteURL;
                                responseHeaders = reply.headers || {};
                                const bytesOut = reply.body ? decodeBase64(reply.body) : new Uint8Array();
                                const text = status === 204 || status === 205 || status === 304 ? "" : new TextDecoder().decode(bytesOut);
                                responseText = text;
                                if (responseType === "json") {
                                    try {
                                        response = text ? JSON.parse(text) : null;
                                    } catch {
                                        response = null;
                                    }
                                } else if (responseType === "arraybuffer") {
                                    response = bytesOut.buffer.slice(bytesOut.byteOffset, bytesOut.byteOffset + bytesOut.byteLength);
                                } else if (responseType === "blob") {
                                    response = new Blob([bytesOut]);
                                } else {
                                    response = text;
                                }
                                debug(`xhr: ${method} ${new URL(absoluteURL).pathname} ${status}`);
                                updateReadyState(4);
                                fire("load", ProgressEvent);
                                fire("loadend", ProgressEvent);
                            } catch (error) {
                                if (aborted) return;
                                debug(`xhr: ${method} ${url} error ${error?.message || error}`);
                                status = 0;
                                statusText = "";
                                responseText = "";
                                response = null;
                                updateReadyState(4);
                                fire("error", ProgressEvent);
                                fire("loadend", ProgressEvent);
                            }
                        })();
                        return undefined;
                    },
                });
                return xhr;
            },
        });
    }

    try {
        installXHRBridge();
        debug("bridge: xhr proxy installed");
    } catch (error) {
        debug(`bridge: xhr proxy failed ${error?.message || error}`);
    }

    const originalFetch = typeof window.fetch === "function" ? window.fetch.bind(window) : null;

    window.fetch = async function bcFetch(input, init) {
        const isRequest = typeof Request !== "undefined" && input instanceof Request;
        const rawUrl = typeof input === "string"
            ? input
            : input instanceof URL
                ? input.href
                : isRequest
                    ? input.url
                    : null;

        if (!rawUrl) {
            if (!originalFetch) throw new TypeError("fetch is not available");
            return originalFetch(input, init);
        }

        if (rawUrl.startsWith("data:")) {
            const comma = rawUrl.indexOf(",");
            if (comma !== -1) {
                const meta = rawUrl.slice(5, comma);
                const payload = rawUrl.slice(comma + 1);
                let text = "";
                try {
                    text = /;base64/i.test(meta)
                        ? new TextDecoder().decode(decodeBase64(payload))
                        : decodeURIComponent(payload);
                } catch {
                    text = "";
                }
                const mime = (meta.split(";").find(part => part.includes("/")) || "text/plain").toLowerCase();
                return new Response(text, { status: 200, headers: { "Content-Type": mime } });
            }
        }

        let url;
        try {
            url = new URL(rawUrl, location.href);
        } catch {
            if (!originalFetch) throw new TypeError("fetch is not available");
            return originalFetch(input, init);
        }

        if (url.protocol !== "https:" || url.hostname !== "discord.com" || !url.pathname.startsWith("/api/")) {
            if (!originalFetch) throw new TypeError("fetch is not available");
            return originalFetch(input, init);
        }

        if (init?.signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");

        const method = String(init?.method || (isRequest ? input.method : "GET")).toUpperCase();
        const headers = headerEntries(init?.headers || (isRequest ? input.headers : null));

        let body = init?.body;
        if (body === undefined && isRequest && method !== "GET" && method !== "HEAD") {
            try {
                body = await input.clone().arrayBuffer();
            } catch {
                body = undefined;
            }
        }

        let bodyBytes = null;
        try {
            bodyBytes = await readBodyBytes(body);
        } catch {
            throw new TypeError("BotClient: unsupported request body");
        }

        if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams && !hasHeader(headers, "content-type")) {
            setHeader(headers, "Content-Type", "application/x-www-form-urlencoded;charset=UTF-8");
        }

        debug(`api: ${method} ${url.pathname}`);
        return sendNative(url.href, method, headers, bodyBytes);
    };

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
            const response = await window.fetch("https://discord.com/api/v10/applications/@me?with_counts=true", {
                headers: {
                    Authorization: token,
                    "User-Agent": BOT_USER_AGENT,
                },
            });
            if (!response.ok) {
                let message = `${response.status} ${response.statusText}`.trim();
                try {
                    const body = await response.json();
                    if (body && body.message) message = `${response.status}: ${body.message}`;
                } catch {
                    // non-JSON error body
                }
                debug(`botinfo: failed status=${response.status}`);
                return { success: false, status: response.status, message };
            }
            const data = await response.json();
            window.__bcBotToken = token;
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
            window.__bcBotMeta = { intents, allShards };
            debug(`botinfo: ok intents=${intents} shards=${allShards}`);
            return { success: true, data, intents, allShards };
        } catch (error) {
            debug(`botinfo: error ${error?.message || error}`);
            return { success: false, message: error?.message || String(error) };
        }
    }

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

    window.BotClientNative = {
        getBotInfo,
        getBotClientVersion: () => "2.0.0",
        getBotClientName: () => "BotClient iOS",
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
        closeWindow: () => {},
        close: () => {},
        minimize: () => {},
        maximize: () => {},
        focus: () => {},
        flashFrame: () => {},
        requestOpenMessageEditorWindow: async () => false,
    };

    window.protoAPI = {
        GetPreloadedUserSettings: () => {},
        GetPreloadedUserSettingsResponse: () => {},
        SetPreloadedUserSettings: () => {},
        GetFrecencyUserSettings: () => {},
        GetFrecencyUserSettingsResponse: () => {},
        SetFrecencyUserSettings: () => {},
    };

    function installStyles() {
        const css = window.__bcVencordCss;
        if (!css || document.getElementById("bc-vencord-css")) return;
        const style = document.createElement("style");
        style.id = "bc-vencord-css";
        style.textContent = css;
        (document.head || document.documentElement).appendChild(style);
    }

    function dispatchMeta() {
        let cssUrl = "data:text/css;base64,";
        try {
            cssUrl += encodeBase64(new TextEncoder().encode(window.__bcVencordCss || ""));
        } catch {
            // empty css fallback
        }
        window.postMessage({
            type: "vencord:meta",
            meta: {
                EXTENSION_VERSION: "1.15.15",
                EXTENSION_BASE_URL: "https://discord.com/",
                RENDERER_CSS_URL: cssUrl,
            },
        }, "*");
        debug("bridge: vencord meta dispatched");
    }

    window.__bcDispatchVencordMeta = dispatchMeta;

    try {
        const rawToken = localStorage.getItem("token");
        const storedToken = rawToken ? JSON.parse(rawToken) : null;
        if (typeof storedToken === "string" && storedToken.length > 20) {
            getBotInfo(storedToken).then(info => {
                debug(`login: restored bot meta ${info.success}`);
            });
        }
    } catch {
        // no stored token on the login page
    }

    window.__bcDebugState = () => ({
        bridge: true,
        native: Boolean(nativeAPI),
        href: location.href,
        hasTokenInput: Boolean(document.querySelector('input[name="token"], input[placeholder="Enter your bot token"]')),
        css: Boolean(document.getElementById("bc-vencord-css")),
    });

    window.__bcDiag = () => {
        const state = {
            href: location.href,
            vencord: typeof window.Vencord,
            vencordTail: Boolean(window.__bcVencordTail),
            vencordError: window.__bcVencordError ? String(window.__bcVencordError).slice(0, 900) : null,
            loginStatus: window.__bcLoginStatus || "idle",
            bodyPreview: (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 120),
        };
        try {
            const webpack = typeof Vencord !== "undefined" ? Vencord?.Webpack : null;
            state.webpack = webpack ? Object.keys(webpack).slice(0, 16) : null;
            const loginModule = webpack?.findByProps?.("loginToken", "login");
            state.loginToken = Boolean(loginModule?.loginToken);
        } catch (error) {
            state.diagError = error?.message || String(error);
        }
        return state;
    };

    window.__bcLoginStatus = "idle";

    window.__bcLoginBot = async token => {
        if (typeof token !== "string" || !token.trim()) {
            window.__bcLoginStatus = "missing-token";
            return false;
        }
        window.__bcLoginStatus = "waiting";
        try {
            localStorage.setItem("currentShard", "0");
        } catch {
            // storage may be unavailable; the login flow works without it
        }
        const info = await getBotInfo(token);
        if (!info.success) {
            window.__bcLoginStatus = `botinfo-failed: ${info.message || "unknown"}`;
            debug("login: bot info unavailable");
            return false;
        }
        const deadline = Date.now() + 30000;
        while (Date.now() < deadline) {
            try {
                const webpack = typeof Vencord !== "undefined" ? Vencord?.Webpack : null;
                const loginModule = webpack?.findByProps?.("loginToken", "login");
                if (loginModule?.loginToken) {
                    window.__bcLoginStatus = "calling";
                    debug("login: calling discord loginToken");
                    await loginModule.loginToken(token.trim());
                    window.__bcLoginStatus = "ok";
                    debug("login: loginToken resolved");
                    return true;
                }
            } catch (error) {
                window.__bcLoginStatus = `error: ${error?.message || error}`;
                debug(`login: error ${error?.message || error}`);
                return false;
            }
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        window.__bcLoginStatus = "module-not-found";
        debug("login: loginToken module not found");
        return false;
    };

    window.__bcAutoLogin = async token => {
        if (typeof token !== "string" || !token.trim()) return false;
        const value = token.trim();
        const info = await getBotInfo(value);
        debug(`login: bot info ${info.success ? "ready" : "unavailable"}`);
        debug("login: waiting for bot token form");
        const deadline = Date.now() + 30000;
        while (Date.now() < deadline) {
            const input = document.querySelector('input[name="token"], input[placeholder="Enter your bot token"]');
            if (input) {
                const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
                if (setter) setter.call(input, value);
                else input.value = value;
                input.dispatchEvent(new Event("input", { bubbles: true }));
                input.dispatchEvent(new Event("change", { bubbles: true }));
                await new Promise(resolve => setTimeout(resolve, 300));
                const scope = input.closest("form") || document;
                const button = Array.from(scope.querySelectorAll("button"))
                    .find(candidate => /login/i.test((candidate.textContent || "").trim()));
                if (button) {
                    button.click();
                    debug("login: submitted bot token form");
                    return true;
                }
            }
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        debug("login: bot token form not found");
        return false;
    };

    window.addEventListener("error", event => {
        debug(`js-error: ${event.message || "unknown"}`);
    });
    window.addEventListener("unhandledrejection", event => {
        debug(`js-rejection: ${event.reason?.message || String(event.reason)}`);
    });

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
            installStyles();
            dispatchMeta();
        }, { once: true });
    } else {
        installStyles();
        dispatchMeta();
    }
})();
