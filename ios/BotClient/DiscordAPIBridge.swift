import Foundation
import os
import WebKit

final class DiscordAPIBridge: NSObject, WKScriptMessageHandlerWithReply {
    private let botUserAgent = "DiscordBot (https://github.com/aiko-chan-ai/DiscordBotClient, v2.0.0)"
    private let allowedMethods: Set<String> = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]
    private let session: URLSession
    private let logger = Logger(subsystem: "local.botclient.ios", category: "api")

    override init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 60
        session = URLSession(configuration: configuration)
        super.init()
    }

    private func reject(_ reply: @escaping (Any?, String?) -> Void, _ reason: String) {
        reply(["error": reason], nil)
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard
            let payload = message.body as? [String: Any],
            let urlString = payload["url"] as? String,
            let url = URL(string: urlString),
            let scheme = url.scheme?.lowercased(),
            scheme == "https",
            let host = url.host?.lowercased(),
            host == "discord.com" || host.hasSuffix(".discord.com"),
            url.path.hasPrefix("/api/")
        else {
            reject(replyHandler, "blocked request")
            return
        }

        let method = (payload["method"] as? String ?? "GET").uppercased()
        guard allowedMethods.contains(method) else {
            reject(replyHandler, "blocked method")
            return
        }

        var headers: [String: String] = [:]
        if let rawHeaders = payload["headers"] as? [String: Any] {
            for (key, value) in rawHeaders where !key.isEmpty {
                headers[key] = String(describing: value)
            }
        }

        var body: Data?
        if let base64Body = payload["body"] as? String {
            guard let decoded = Data(base64Encoded: base64Body) else {
                reject(replyHandler, "invalid body")
                return
            }
            body = decoded
        }

        for key in headers.keys {
            let lower = key.lowercased()
            if lower == "origin" || lower == "referer" || lower == "cookie" || lower == "host"
                || lower == "content-length" || lower == "accept-encoding" || lower.hasPrefix("sec-") {
                headers.removeValue(forKey: key)
            }
        }

        if let authKey = headers.keys.first(where: { $0.lowercased() == "authorization" }) {
            let value = (headers[authKey] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if value.isEmpty {
                headers.removeValue(forKey: authKey)
            } else if value.range(of: "^(bot|bearer)\\s", options: [.regularExpression, .caseInsensitive]) == nil {
                headers[authKey] = "Bot \(value)"
            } else {
                headers[authKey] = value
            }
        }

        headers["User-Agent"] = botUserAgent

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 30
        request.httpShouldHandleCookies = false
        request.allHTTPHeaderFields = headers
        request.httpBody = body

        session.dataTask(with: request) { [logger] data, response, error in
            if let error {
                logger.debug("request failed: \(method, privacy: .public) \(url.path, privacy: .public) \(error.localizedDescription, privacy: .public)")
                DispatchQueue.main.async {
                    replyHandler(["error": "network"], nil)
                }
                return
            }

            guard let http = response as? HTTPURLResponse else {
                DispatchQueue.main.async {
                    replyHandler(["error": "invalid response"], nil)
                }
                return
            }

            logger.debug("response: \(method, privacy: .public) \(url.path, privacy: .public) \(http.statusCode, privacy: .public)")

            var responseHeaders: [String: String] = [:]
            for (key, value) in http.allHeaderFields {
                let name = String(describing: key)
                guard name.lowercased() != "set-cookie" else { continue }
                responseHeaders[name] = String(describing: value)
            }

            let body = (data ?? Data()).base64EncodedString()
            DispatchQueue.main.async {
                replyHandler([
                    "status": http.statusCode,
                    "statusText": HTTPURLResponse.localizedString(forStatusCode: http.statusCode),
                    "headers": responseHeaders,
                    "body": body,
                    "url": http.url?.absoluteString ?? url.absoluteString,
                ], nil)
            }
        }.resume()
    }
}
