(() => {
    "use strict";
    if (window.__bcRunUITest) return;

    window.__bcRunUITest = function (guild, channel, message) {
        if (window.__bcUITest) return "already-installed";
        const target = "/channels/" + guild + "/" + channel;
        const log = (...args) => {
            try {
                console.log("bc-uitest:", ...args);
            } catch {
                // logging must never break the page
            }
        };
        const state = { navigating: false, sending: false, sent: false };
        window.__bcUITest = state;
        const findComposer = () => document.querySelector(
            '[role="textbox"][contenteditable="true"], [data-slate-editor="true"][contenteditable="true"], [contenteditable="true"], textarea'
        );
        const findSend = () => {
            const direct = document.querySelector(
                '[data-testid="send-button"], button[class*="sendButton"], [class*="sendButton"], [class*="sendButton"] [role="button"]'
            );
            if (direct) return direct;
            const composer = findComposer();
            const form = composer?.closest("form");
            const submit = form?.querySelector('button[type="submit"]') || document.querySelector('button[type="submit"]');
            if (submit) return submit;
            const labeled = Array.prototype.find.call(
                document.querySelectorAll('button, [role="button"]'),
                element => /^(send message|メッセージを送信|送信)$/i.test((element.getAttribute("aria-label") || "").trim())
            );
            if (labeled) return labeled;
            const candidates = Array.prototype.map.call(
                document.querySelectorAll('button, [role="button"]'),
                element => ({ element, rect: element.getBoundingClientRect() })
            ).filter(({ element, rect }) => rect.width > 4 && rect.height > 4
                && rect.left > window.innerWidth * 0.7
                && rect.top > window.innerHeight * 0.6
                && element.getAttribute("aria-hidden") !== "true"
                && !element.disabled);
            candidates.sort((a, b) => b.rect.left - a.rect.left);
            return candidates[0]?.element || null;
        };
        const clickSendPoint = () => {
            const point = document.elementFromPoint(window.innerWidth - 24, window.innerHeight - 56);
            if (!point) return false;
            const target = point.closest('button, [role="button"]') || point;
            log("clicking point", target.tagName, (target.className?.baseVal || target.className || "").toString().slice(0, 60));
            target.click();
            return true;
        };
        const pressEnter = box => {
            box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
            box.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
        };
        const sendWhenReady = () => {
            if (state.sending || state.sent) return;
            state.sending = true;
            const channelStore = window.Vencord?.Webpack?.Common?.ChannelStore;
            let channelName = "unknown";
            try { channelName = channelStore?.getChannel?.(channel)?.name || "unknown"; } catch {}
            log("send armed at", location.pathname, "channel=", channelName);
            let tries = 0;
            const timer = setInterval(() => {
                tries += 1;
                const box = findComposer();
                const send = findSend();
                if (box && (send || tries >= 4)) {
                    clearInterval(timer);
                    log("composer ready after", tries, "tries", "button=", !!send, "tag=", box.tagName);
                    if (box.tagName === "TEXTAREA") {
                        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
                        setter?.call(box, message);
                        box.dispatchEvent(new Event("input", { bubbles: true }));
                    } else {
                        box.focus();
                        const inserted = document.execCommand("insertText", false, message);
                        box.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: message }));
                        log("insertText", inserted);
                    }
                    setTimeout(() => {
                        const button = findSend();
                        let clicked = false;
                        if (button) {
                            log("clicking send candidate", button.tagName, (button.getAttribute("aria-label") || "").slice(0, 30));
                            button.click();
                            clicked = true;
                        }
                        if (!clicked) clicked = clickSendPoint();
                        if (!clicked) {
                            log("no send control, pressing Enter");
                            pressEnter(box);
                        }
                        setTimeout(() => {
                            const remaining = (findComposer()?.textContent || "").trim();
                            log("composer text length after send", remaining.length);
                            if (remaining.length > 0) {
                                clickSendPoint();
                                pressEnter(box);
                                log("send retry dispatched");
                            }
                            state.sent = true;
                            state.sending = false;
                        }, 2000);
                    }, 800);
                } else {
                    if (!send && tries === 12) {
                        const labels = Array.prototype.map.call(
                            document.querySelectorAll('button, [role="button"]'),
                            element => (element.getAttribute("aria-label") || element.getAttribute("data-testid") || element.tagName).slice(0, 30)
                        );
                        log("button labels", labels.slice(0, 12).join(" | "));
                    }
                    if (tries >= 240) {
                        clearInterval(timer);
                        log("composer timeout", !!box, !!send);
                        state.sending = false;
                        state.sent = true;
                    }
                }
            }, 500);
        };
        const tick = () => {
            if (state.sent) return;
            if (location.pathname === target) {
                sendWhenReady();
                return;
            }
            if (!location.pathname.startsWith("/app") && !location.pathname.startsWith("/channels")) {
                log("waiting for login at", location.pathname);
                return;
            }
            if (state.navigating) return;
            const webpack = window.Vencord?.Webpack;
            const common = webpack?.Common || {};
            const router = common.NavigationRouter
                || common.Router
                || webpack?.findByProps?.("transitionTo", "transitionToGuild")
                || webpack?.findByProps?.("transitionTo");
            if (!router?.transitionTo) {
                if (!state.reportedRouter) {
                    state.reportedRouter = true;
                    const keys = Object.keys(common).filter(key => /nav|rout|histor/i.test(key));
                    log("router not ready at", location.pathname, "common keys=", keys.join(","), "hasVencord=", !!window.Vencord);
                }
                return;
            }
            state.navigating = true;
            log("navigating from", location.pathname, "to", target);
            try {
                router.transitionTo(target);
            } catch (error) {
                log("router failed", String(error));
                state.navigating = false;
            }
        };
        setInterval(tick, 2000);
        tick();
        return "installed";
    };
})();
