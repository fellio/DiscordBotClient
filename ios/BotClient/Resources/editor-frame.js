(() => {
    "use strict";
    if (window.__bcEditorFrameInstalled) return;
    window.__bcEditorFrameInstalled = true;

    const native = window.webkit?.messageHandlers?.bcEditor ?? null;

    function log(...parts) {
        try {
            window.webkit?.messageHandlers?.bcLog?.postMessage(parts.map(part => String(part)).join(" ").slice(0, 1500));
        } catch {
            // logging must never break the editor
        }
    }

    // WebKit denies storage on custom schemes, but the editor reads localStorage before it boots.
    for (const name of ["localStorage", "sessionStorage"]) {
        try {
            const storage = window[name];
            storage.setItem("bc-probe", "1");
            storage.removeItem("bc-probe");
        } catch {
            const store = new Map();
            const shim = {
                getItem: key => store.has(String(key)) ? store.get(String(key)) : null,
                setItem: (key, value) => {
                    store.set(String(key), String(value));
                },
                removeItem: key => {
                    store.delete(String(key));
                },
                clear: () => {
                    store.clear();
                },
                key: index => Array.from(store.keys())[index] ?? null,
                get length() {
                    return store.size;
                },
            };
            try {
                Object.defineProperty(window, name, { value: shim, configurable: true });
                log(`${name}: in-memory shim installed`);
            } catch (error) {
                log(`${name}: shim failed ${error?.message || error}`);
            }
        }
    }

    try {
        if (!crypto.randomUUID) {
            Object.defineProperty(crypto, "randomUUID", {
                value: () => {
                    const bytes = crypto.getRandomValues(new Uint8Array(16));
                    bytes[6] = (bytes[6] & 0x0f) | 0x40;
                    bytes[8] = (bytes[8] & 0x3f) | 0x80;
                    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
                    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
                },
                configurable: true,
            });
        }
    } catch (error) {
        log(`randomUUID: shim failed ${error?.message || error}`);
    }

    function encodeBase64(bytes) {
        let binary = "";
        const chunk = 0x8000;
        for (let index = 0; index < bytes.length; index += chunk) {
            binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk));
        }
        return btoa(binary);
    }

    let hostPort = null;
    let initPayload = null;
    let readySent = false;

    function deliverInit(payload) {
        initPayload = payload;
        window.__bcEditorInitAt = Date.now();
        if (!hostPort) return;
        try {
            hostPort.postMessage(payload);
            log("init delivered");
        } catch (error) {
            log(`init failed ${error?.message || error}`);
        }
    }

    function createPort() {
        try {
            hostPort?.close();
        } catch {
            // previous port may already be closed
        }
        const channel = new MessageChannel();
        hostPort = channel.port2;
        hostPort.onmessage = event => {
            const data = event.data;
            if (!data || data.type !== "submit") return;
            const files = [];
            for (const file of Array.isArray(data.files) ? data.files : []) {
                try {
                    files.push({
                        name: file.name,
                        size: file.size,
                        type: file.type,
                        buffer: encodeBase64(new Uint8Array(file.buffer)),
                    });
                } catch (error) {
                    log(`file encode failed ${error?.message || error}`);
                }
            }
            const payload = {
                type: "submit",
                payload: {
                    action: data.action,
                    profile: data.profile,
                    messages: data.messages,
                    files,
                },
            };
            try {
                native?.postMessage(payload);
                log(`submit action=${data.action} files=${files.length}`);
            } catch (error) {
                log(`submit failed ${error?.message || error}`);
            }
        };
        hostPort.start();
        window.postMessage("forward-editor-port", "*", [channel.port1]);
        log("port delivered");
    }

    window.electronAPI = {
        reactReady: () => {
            createPort();
            if (initPayload) deliverInit(initPayload);
            if (!readySent) {
                readySent = true;
                try {
                    native?.postMessage({ type: "ready" });
                } catch (error) {
                    log(`ready failed ${error?.message || error}`);
                }
            }
        },
        closeWindow: () => {
            try {
                native?.postMessage({ type: "close" });
            } catch {
                // closing is best-effort
            }
        },
    };

    window.__bcEditorInit = payload => deliverInit(payload);

    log("editor frame installed");
})();
