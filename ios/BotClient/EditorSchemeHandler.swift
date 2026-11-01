import Foundation
import WebKit

final class EditorSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "bc-editor"

    private let root: URL?
    private let indexURL: URL?
    private let frameScript: String?

    override init() {
        let bundle = Bundle.main
        let folder = bundle.url(forResource: "editor", withExtension: nil)
            ?? bundle.url(forResource: "Editor", withExtension: nil)
        root = folder
        indexURL = folder?.appendingPathComponent("index.html")
        if let scriptURL = bundle.url(forResource: "editor-frame", withExtension: "js"),
           let source = try? String(contentsOf: scriptURL, encoding: .utf8) {
            frameScript = source
        } else {
            frameScript = nil
        }
        super.init()
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let requestURL = urlSchemeTask.request.url, let root else {
            fail(urlSchemeTask, code: .fileDoesNotExist)
            return
        }

        let path = (requestURL.path.removingPercentEncoding ?? requestURL.path)
        let relative = path.hasPrefix("/") ? String(path.dropFirst()) : path
        let candidate = relative.isEmpty
            ? root.appendingPathComponent("index.html")
            : root.appendingPathComponent(relative).standardizedFileURL
        let rootPath = root.standardizedFileURL.path
        guard candidate.path == rootPath || candidate.path.hasPrefix(rootPath + "/") else {
            fail(urlSchemeTask, code: .noPermissionsToReadFile)
            return
        }

        var isDirectory: ObjCBool = false
        let exists = FileManager.default.fileExists(atPath: candidate.path, isDirectory: &isDirectory)
        var fileURL = candidate
        if !exists || isDirectory.boolValue {
            guard let indexURL else {
                fail(urlSchemeTask, code: .fileDoesNotExist)
                return
            }
            fileURL = indexURL
        }

        guard var data = try? Data(contentsOf: fileURL) else {
            fail(urlSchemeTask, code: .fileDoesNotExist)
            return
        }
        if fileURL.lastPathComponent.lowercased() == "index.html",
           let frameScript,
           var html = String(data: data, encoding: .utf8),
           let head = html.range(of: "<head>", options: .caseInsensitive) {
            html.insert(contentsOf: "<script>\(frameScript)</script>", at: head.upperBound)
            if let injected = html.data(using: .utf8) {
                data = injected
            }
        }

        let headers = [
            "Content-Type": Self.mimeType(for: fileURL.pathExtension),
            "Content-Length": String(data.count),
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-cache",
        ]
        guard let response = HTTPURLResponse(
            url: requestURL,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: headers
        ) else {
            fail(urlSchemeTask, code: .badServerResponse)
            return
        }
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

    private func fail(_ task: WKURLSchemeTask, code: URLError.Code) {
        task.didFailWithError(URLError(code))
    }

    private static func mimeType(for pathExtension: String) -> String {
        switch pathExtension.lowercased() {
        case "html", "htm": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json", "map": return "application/json; charset=utf-8"
        case "webmanifest": return "application/manifest+json"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "gif": return "image/gif"
        case "webp": return "image/webp"
        case "ico": return "image/x-icon"
        case "woff": return "font/woff"
        case "woff2": return "font/woff2"
        case "ttf": return "font/ttf"
        case "otf": return "font/otf"
        case "wasm": return "application/wasm"
        case "txt": return "text/plain; charset=utf-8"
        default: return "application/octet-stream"
        }
    }
}
