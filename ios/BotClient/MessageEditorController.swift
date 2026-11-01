import os
import UIKit
import WebKit

private let editorLog = Logger(subsystem: "local.botclient.ios", category: "editor")
private let editorEntryURL = URL(string: "bc-editor://local/index.html")!

final class MessageEditorController: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    weak var discordWebView: WKWebView?

    private var editorWebView: WKWebView?
    private weak var presentedController: UIViewController?
    private var schemeHandler: EditorSchemeHandler?
    private var closeWorkItem: DispatchWorkItem?

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        switch message.name {
        case "bcLog":
            #if DEBUG
            if let text = message.body as? String {
                editorLog.debug("web: \(String(text.prefix(2000)), privacy: .public)")
            }
            #endif
        case "bcEditor":
            handle(message.body)
        default:
            break
        }
    }

    private func handle(_ body: Any) {
        guard let payload = body as? [String: Any], let type = payload["type"] as? String else { return }
        switch type {
        case "open":
            presentEditor()
        case "ready":
            editorLog.debug("editor ready")
            sendToDiscord(["type": "ready"])
        case "init":
            guard let initPayload = payload["payload"] as? [String: Any] else { return }
            sendToEditor(initPayload)
        case "submit":
            guard let data = payload["payload"] as? [String: Any] else {
                editorLog.error("editor submit missing payload")
                return
            }
            editorLog.debug("editor submit action=\(data["action"] as? String ?? "unknown", privacy: .public) files=\((data["files"] as? [Any])?.count ?? 0) messages=\((data["messages"] as? [Any])?.count ?? -1)")
            sendToDiscord(["type": "submit", "data": data])
            closeWorkItem?.cancel()
            let work = DispatchWorkItem { [weak self] in self?.dismiss() }
            closeWorkItem = work
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4, execute: work)
        case "close":
            editorLog.debug("editor close requested")
            closeWorkItem?.cancel()
            let work = DispatchWorkItem { [weak self] in self?.dismiss() }
            closeWorkItem = work
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.6, execute: work)
        default:
            break
        }
    }

    private func sendToDiscord(_ payload: [String: Any]) {
        guard let webView = discordWebView,
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else {
            return
        }
        let source = "window.__bcEditorEvent ? window.__bcEditorEvent(JSON.parse(\(DiscordWebView.jsStringLiteral(json)))) : 0"
        webView.evaluateJavaScript(source) { _, error in
            if let error {
                editorLog.error("editor relay failed: \(error.localizedDescription, privacy: .public)")
            }
        }
    }

    private func sendToEditor(_ payload: [String: Any]) {
        guard let webView = editorWebView,
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else {
            editorLog.error("editor init serialization failed")
            return
        }
        let source = "window.__bcEditorInit ? window.__bcEditorInit(JSON.parse(\(DiscordWebView.jsStringLiteral(json)))) : 0"
        webView.evaluateJavaScript(source) { _, error in
            if let error {
                editorLog.error("editor init failed: \(error.localizedDescription, privacy: .public)")
            } else {
                editorLog.debug("editor init delivered")
            }
        }
    }

    private func presentEditor() {
        guard presentedController == nil else {
            editorLog.debug("editor is already open")
            return
        }
        guard let presenter = topViewController() else {
            editorLog.error("no presenter available for editor")
            return
        }

        let handler = EditorSchemeHandler()
        schemeHandler = handler

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.defaultWebpagePreferences.preferredContentMode = .mobile
        configuration.setURLSchemeHandler(handler, forURLScheme: EditorSchemeHandler.scheme)
        configuration.userContentController.add(self, contentWorld: .page, name: "bcEditor")
        configuration.userContentController.add(self, name: "bcLog")

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.allowsBackForwardNavigationGestures = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        #if DEBUG
        webView.isInspectable = true
        #endif

        let controller = EditorViewController(webView: webView)
        controller.onClose = { [weak self] in self?.dismiss() }
        let navigation = UINavigationController(rootViewController: controller)
        navigation.modalPresentationStyle = .overFullScreen
        presenter.present(navigation, animated: true)

        presentedController = navigation
        editorWebView = webView
        webView.load(URLRequest(url: editorEntryURL))
        editorLog.debug("editor presented")
    }

    private func dismiss() {
        closeWorkItem?.cancel()
        closeWorkItem = nil
        guard let controller = presentedController else {
            cleanupEditor()
            return
        }
        sendToDiscord(["type": "closed"])
        controller.dismiss(animated: true) { [weak self] in
            self?.cleanupEditor()
        }
    }

    private func cleanupEditor() {
        editorLog.debug("editor dismissed")
        if let webView = editorWebView {
            webView.navigationDelegate = nil
            webView.configuration.userContentController.removeScriptMessageHandler(forName: "bcEditor", contentWorld: .page)
            webView.configuration.userContentController.removeScriptMessageHandler(forName: "bcLog")
        }
        editorWebView = nil
        presentedController = nil
        schemeHandler = nil
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

    private func presentLoadError(_ error: Error) {
        editorLog.error("editor load failed: \(error.localizedDescription, privacy: .public)")
        guard let presenter = presentedController else { return }
        let alert = UIAlertController(
            title: "メッセージエディタ",
            message: "エディタの読み込みに失敗しました: \(error.localizedDescription)",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "閉じる", style: .default) { [weak self] _ in
            self?.dismiss()
        })
        presenter.present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        editorLog.debug("editor loaded: \(webView.url?.absoluteString ?? "unknown", privacy: .public)")
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        let nsError = error as NSError
        guard nsError.code != NSURLErrorCancelled else { return }
        presentLoadError(error)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let nsError = error as NSError
        guard nsError.code != NSURLErrorCancelled else { return }
        presentLoadError(error)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        editorLog.error("editor web process terminated; reloading")
        webView.reload()
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url, let scheme = url.scheme?.lowercased() else {
            decisionHandler(.allow)
            return
        }
        if scheme == EditorSchemeHandler.scheme || scheme == "about" || scheme == "data" || scheme == "blob" {
            decisionHandler(.allow)
            return
        }
        if navigationAction.navigationType == .linkActivated {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url {
            UIApplication.shared.open(url)
        }
        return nil
    }
}

private final class EditorViewController: UIViewController {
    private let webView: WKWebView
    var onClose: (() -> Void)?

    init(webView: WKWebView) {
        self.webView = webView
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        title = "メッセージエディタ"
        edgesForExtendedLayout = []

        let appearance = UINavigationBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = UIColor(red: 0.118, green: 0.122, blue: 0.133, alpha: 1)
        appearance.titleTextAttributes = [.foregroundColor: UIColor.white]
        navigationController?.navigationBar.standardAppearance = appearance
        navigationController?.navigationBar.scrollEdgeAppearance = appearance
        navigationController?.navigationBar.compactAppearance = appearance
        navigationController?.navigationBar.tintColor = .white

        navigationItem.leftBarButtonItem = UIBarButtonItem(
            barButtonSystemItem: .close,
            target: self,
            action: #selector(closeTapped)
        )

        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
    }

    @objc private func closeTapped() {
        onClose?()
    }
}
