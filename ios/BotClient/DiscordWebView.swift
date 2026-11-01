import os
import SwiftUI
import UIKit
import WebKit

private let discordUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1"
private let desktopDiscordUserAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
private let discordLoginURL = URL(string: "https://discord.com/login")!
private let log = Logger(subsystem: "local.botclient.ios", category: "web")

struct DiscordWebView: UIViewRepresentable {
    @ObservedObject var model: WebViewModel

    func makeCoordinator() -> Coordinator {
        Coordinator(model: model)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.defaultWebpagePreferences.preferredContentMode = .mobile
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = true

        let apiBridge = DiscordAPIBridge()
        context.coordinator.apiBridge = apiBridge
        configuration.userContentController.addScriptMessageHandler(apiBridge, contentWorld: .page, name: "bcApi")
        configuration.userContentController.add(context.coordinator.editorController, contentWorld: .page, name: "bcEditor")
        configuration.userContentController.add(context.coordinator, name: "bcLog")
        for script in Self.makeUserScripts() {
            configuration.userContentController.addUserScript(script)
        }
        #if DEBUG
        if let token = ProcessInfo.processInfo.environment["BC_BOT_TOKEN"], !token.isEmpty {
            let source = "try { localStorage.setItem('token', JSON.stringify(\(Self.jsStringLiteral(token)))); } catch {}"
            configuration.userContentController.addUserScript(
                WKUserScript(source: source, injectionTime: .atDocumentStart, forMainFrameOnly: true)
            )
        }
        #endif

        let webView = WKWebView(frame: .zero, configuration: configuration)
        context.coordinator.editorController.discordWebView = webView
        #if DEBUG
        let useDesktopLayout = ProcessInfo.processInfo.environment["BC_DESKTOP_UA"] == "1"
        #else
        let useDesktopLayout = false
        #endif
        webView.customUserAgent = useDesktopLayout ? desktopDiscordUserAgent : discordUserAgent
        if useDesktopLayout {
            webView.pageZoom = 0.6
            log.debug("using desktop user agent with 0.6 zoom")
        }
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.keyboardDismissMode = .interactive
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        #if DEBUG
        webView.isInspectable = true
        #endif
        model.webView = webView
        webView.load(URLRequest(url: discordLoginURL))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "bcApi", contentWorld: .page)
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "bcEditor", contentWorld: .page)
        webView.configuration.userContentController.removeScriptMessageHandler(forName: "bcLog")
        coordinator.editorController.discordWebView = nil
        webView.navigationDelegate = nil
        webView.uiDelegate = nil
    }

    static func jsStringLiteral(_ value: String) -> String {
        guard let data = try? JSONEncoder().encode([value]),
              let array = String(data: data, encoding: .utf8) else {
            return "\"\""
        }
        return String(array.dropFirst().dropLast())
    }

    private static func resourceURL(name: String, extension ext: String) -> URL? {
        if let direct = Bundle.main.url(forResource: name, withExtension: ext) {
            return direct
        }
        guard let root = Bundle.main.resourceURL,
              let enumerator = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil) else {
            return nil
        }
        let filename = "\(name).\(ext)"
        while let candidate = enumerator.nextObject() as? URL {
            if candidate.lastPathComponent == filename {
                return candidate
            }
        }
        return nil
    }

    private static func makeUserScripts() -> [WKUserScript] {
        guard
            let bridgeURL = resourceURL(name: "bridge", extension: "js"),
            let vencordURL = resourceURL(name: "Vencord", extension: "js"),
            let cssURL = resourceURL(name: "Vencord", extension: "css"),
            let bridgeSource = try? String(contentsOf: bridgeURL, encoding: .utf8),
            let vencordSource = try? String(contentsOf: vencordURL, encoding: .utf8),
            let css = try? String(contentsOf: cssURL, encoding: .utf8)
        else {
            log.error("Vencord resources are missing from the app bundle")
            return []
        }

        #if DEBUG
        let debugFlag = "window.__bcDebugLogs = true;\n"
        #else
        let debugFlag = ""
        #endif
        let bootstrap = "\(debugFlag)window.__bcVencordCss = \(jsStringLiteral(css));\n\(bridgeSource)"
        let exportedVencord = """
        try {
        \(vencordSource)
        window.__bcVencordTail = true;
        window.Vencord = Vencord;
        } catch (error) {
        window.__bcVencordError = String((error && (error.stack || error.message)) || error);
        console.error("vencord boot failed", error);
        }
        """
        return [
            WKUserScript(source: bootstrap, injectionTime: .atDocumentStart, forMainFrameOnly: false),
            WKUserScript(source: exportedVencord, injectionTime: .atDocumentStart, forMainFrameOnly: false),
        ]
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        private let model: WebViewModel
        var apiBridge: DiscordAPIBridge?
        let editorController = MessageEditorController()
        private var didAttemptDebugLogin = false

        init(model: WebViewModel) {
            self.model = model
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            #if DEBUG
            if message.name == "bcLog", let text = message.body as? String {
                log.debug("web: \(String(text.prefix(400)), privacy: .public)")
            }
            #endif
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            Task { @MainActor in
                model.isLoading = true
                model.errorMessage = nil
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            Task { @MainActor in
                model.isLoading = false
                model.errorMessage = nil
            }
            #if DEBUG
            log.debug("page loaded: \(webView.url?.absoluteString ?? "unknown", privacy: .public)")
            webView.evaluateJavaScript("window.__bcDebugState ? window.__bcDebugState() : null") { result, error in
                if let error {
                    log.debug("debug state failed: \(error.localizedDescription, privacy: .public)")
                } else if let result {
                    log.debug("debug state: \(String(describing: result), privacy: .public)")
                }
            }
            logDiagnostics(webView, delay: 6)
            logDiagnostics(webView, delay: 14)
            runUITest(webView)
            runEditorUITest(webView)
            #endif
            attemptDebugLogin(webView)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            handleNavigationError(error)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            handleNavigationError(error)
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            log.error("web content process terminated; reloading")
            webView.reload()
        }

        private func handleNavigationError(_ error: Error) {
            let nsError = error as NSError
            if nsError.code == NSURLErrorCancelled || nsError.code == 102 {
                return
            }
            log.error("navigation failed: \(nsError.localizedDescription, privacy: .public)")
            Task { @MainActor in
                model.isLoading = false
                model.errorMessage = nsError.localizedDescription
            }
        }

        private func attemptDebugLogin(_ webView: WKWebView) {
            #if DEBUG
            guard !didAttemptDebugLogin,
                  let token = ProcessInfo.processInfo.environment["BC_BOT_TOKEN"],
                  !token.isEmpty else {
                return
            }
            didAttemptDebugLogin = true
            let literal = DiscordWebView.jsStringLiteral(token)
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                let js = """
                (() => {
                  if (!window.__bcLoginBot || !location.pathname.startsWith("/login")) return 0;
                  Promise.resolve(window.__bcLoginBot(\(literal))).then(ok => {
                    if (!ok && window.__bcAutoLogin) window.__bcAutoLogin(\(literal));
                  }).catch(() => {
                    if (window.__bcAutoLogin) window.__bcAutoLogin(\(literal));
                  });
                  return 1;
                })()
                """
                webView.evaluateJavaScript(js) { _, error in
                    if let error {
                        log.error("auto login failed: \(error.localizedDescription, privacy: .public)")
                    }
                }
            }
            #endif
        }

        #if DEBUG
        private func logDiagnostics(_ webView: WKWebView, delay: TimeInterval) {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                webView.evaluateJavaScript("JSON.stringify(window.__bcDiag ? window.__bcDiag() : null)") { result, error in
                    if let error {
                        log.debug("diag failed: \(error.localizedDescription, privacy: .public)")
                    } else if let result = result as? String {
                        log.debug("diag: \(result, privacy: .public)")
                    }
                }
            }
        }

        private func runUITest(_ webView: WKWebView) {
            let environment = ProcessInfo.processInfo.environment
            guard let target = environment["BC_UI_TEST"] else { return }
            let parts = target.split(separator: "/", maxSplits: 2).map(String.init)
            guard parts.count == 2 else {
                log.error("BC_UI_TEST must be <guild>/<channel>")
                return
            }
            let message = environment["BC_UI_TEST_MESSAGE"] ?? "BotClient iOS UI test"
            let js = """
            (() => {
              if (window.__bcUITest) { return "already-installed"; }
              const guild = \(DiscordWebView.jsStringLiteral(parts[0]));
              const channel = \(DiscordWebView.jsStringLiteral(parts[1]));
              const message = \(DiscordWebView.jsStringLiteral(message));
              const target = "/channels/" + guild + "/" + channel;
              const log = (...args) => { try { console.log("bc-uitest:", ...args); } catch {} };
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
                try { router.transitionTo(target); }
                catch (error) { log("router failed", String(error)); state.navigating = false; }
              };
              setInterval(tick, 2000);
              tick();
              return "installed";
            })()
            """
            webView.evaluateJavaScript(js) { result, error in
                if let error {
                    log.error("ui test install failed: \(error.localizedDescription, privacy: .public)")
                } else {
                    log.debug("ui test: \(String(describing: result), privacy: .public)")
                }
            }
        }

        private func runEditorUITest(_ webView: WKWebView) {
            guard ProcessInfo.processInfo.environment["BC_EDITOR_TEST"] == "1" else { return }
            let js = """
            (() => {
              if (window.__bcEditorOpenTest) { return "already-installed"; }
              window.__bcEditorOpenTest = true;
              const log = (...args) => { try { console.log("bc-editortest:", ...args); } catch {} };
              let clicked = false;
              let reported = false;
              const timer = setInterval(() => {
                if (clicked) return;
                if (!location.pathname.startsWith("/channels/")) return;
                const launcher = document.getElementById("bc-editor-launcher");
                if (!launcher) {
                  if (!reported) {
                    reported = true;
                    log("launcher missing at", location.pathname, "vencord=", typeof window.Vencord, "plugins=", Boolean(window.Vencord?.Plugins?.plugins));
                  }
                  return;
                }
                if (getComputedStyle(launcher).display === "none") {
                  if (!reported) {
                    reported = true;
                    log("launcher hidden plugins=", Object.keys(window.Vencord?.Plugins?.plugins || {}).slice(0, 12).join(","), "channel=", Boolean(document.querySelector('[role="textbox"][contenteditable="true"]')));
                  }
                  return;
                }
                clicked = true;
                clearInterval(timer);
                log("clicking launcher at", location.pathname);
                launcher.click();
              }, 2000);
              return "installed";
            })()
            """
            webView.evaluateJavaScript(js) { result, error in
                if let error {
                    log.error("editor ui test install failed: \(error.localizedDescription, privacy: .public)")
                } else {
                    log.debug("editor ui test: \(String(describing: result), privacy: .public)")
                }
            }
        }
        #endif

        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            guard let url = navigationAction.request.url else { return nil }
            if let host = url.host?.lowercased(), host == "discord.com" || host.hasSuffix(".discord.com") {
                webView.load(URLRequest(url: url))
            } else {
                UIApplication.shared.open(url)
            }
            return nil
        }

        func webView(
            _ webView: WKWebView,
            runJavaScriptAlertPanelWithMessage message: String,
            initiatedByFrame frame: WKFrameInfo,
            completionHandler: @escaping () -> Void
        ) {
            presentAlert(title: "Discord", message: message, completion: completionHandler)
        }

        func webView(
            _ webView: WKWebView,
            runJavaScriptConfirmPanelWithMessage message: String,
            initiatedByFrame frame: WKFrameInfo,
            completionHandler: @escaping (Bool) -> Void
        ) {
            guard let presenter = topViewController() else {
                completionHandler(false)
                return
            }
            let alert = UIAlertController(title: "Discord", message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "キャンセル", style: .cancel) { _ in completionHandler(false) })
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
            presenter.present(alert, animated: true)
        }

        private func presentAlert(title: String, message: String, completion: @escaping () -> Void) {
            guard let presenter = topViewController() else {
                completion()
                return
            }
            let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completion() })
            presenter.present(alert, animated: true)
        }

        private func topViewController() -> UIViewController? {
            let scene = UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .first { $0.activationState == .foregroundActive }
            var controller = scene?.windows.first(where: \.isKeyWindow)?.rootViewController
            while let presented = controller?.presentedViewController {
                controller = presented
            }
            return controller
        }
    }
}
