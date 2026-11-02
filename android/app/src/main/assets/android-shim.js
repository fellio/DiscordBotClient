(() => {
    "use strict";
    if (window.__bcNativeShimInstalled) return;
    window.__bcNativeShimInstalled = true;

    const pending = new Map();
    const outbox = [];
    let host = window.BCNative || null;
    let counter = 0;

    function handleReply(event) {
        let data = event.data;
        if (typeof data === "string") {
            try {
                data = JSON.parse(data);
            } catch {
                return;
            }
        }
        if (!data || !data.id) return;
        const entry = pending.get(data.id);
        if (!entry) return;
        pending.delete(data.id);
        window.clearTimeout(entry.timer);
        if (data.error) entry.reject(new Error(String(data.error)));
        else entry.resolve(data.payload);
    }

    function attach(candidate) {
        host = candidate || window.BCNative || null;
        if (!host) return null;
        host.onmessage = handleReply;
        while (outbox.length) {
            const raw = outbox.shift();
            try {
                host.postMessage(raw);
            } catch {
                // the page may be navigating
            }
        }
        return host;
    }

    function sendRaw(raw) {
        const target = host || attach();
        if (target) {
            try {
                target.postMessage(raw);
                return;
            } catch {
                // fall through to the outbox
            }
        }
        outbox.push(raw);
        window.setTimeout(() => {
            const index = outbox.indexOf(raw);
            if (index !== -1) outbox.splice(index, 1);
        }, 30_000);
    }

    function request(kind, payload) {
        return new Promise((resolve, reject) => {
            const id = `bc-${Date.now()}-${++counter}`;
            const timer = window.setTimeout(() => {
                pending.delete(id);
                reject(new Error("native bridge timeout"));
            }, 60_000);
            pending.set(id, { resolve, reject, timer });
            sendRaw(JSON.stringify({ id, kind, payload }));
        });
    }

    function log(message) {
        try {
            sendRaw(JSON.stringify({ kind: "log", payload: String(message) }));
        } catch {
            // logging must never break the page
        }
    }

    if (!host) {
        const wait = window.setInterval(() => {
            if (window.BCNative) {
                window.clearInterval(wait);
                attach();
            }
        }, 50);
        window.setTimeout(() => window.clearInterval(wait), 30_000);
    } else {
        attach(host);
    }

    window.webkit = window.webkit || {};
    window.webkit.messageHandlers = {
        bcApi: {
            postMessage: payload => request("api", payload),
        },
        bcEditor: {
            postMessage: payload => {
                sendRaw(JSON.stringify({ id: `bc-editor-${++counter}`, kind: "editor", payload }));
            },
        },
        bcLog: {
            postMessage: message => log(message),
        },
    };
})();
