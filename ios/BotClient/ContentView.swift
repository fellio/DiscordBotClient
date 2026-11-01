import SwiftUI
import WebKit

@MainActor
final class WebViewModel: ObservableObject {
    weak var webView: WKWebView?
    @Published var isLoading = true
    @Published var errorMessage: String?

    func reload() {
        errorMessage = nil
        isLoading = true
        webView?.reload()
    }
}

struct ContentView: View {
    @StateObject private var model = WebViewModel()

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            DiscordWebView(model: model)
                .ignoresSafeArea()

            if model.isLoading {
                ProgressView()
                    .progressViewStyle(.circular)
                    .tint(.white)
                    .padding(12)
                    .background(.black.opacity(0.55), in: Capsule())
                    .frame(maxHeight: .infinity, alignment: .top)
                    .padding(.top, 16)
                    .allowsHitTesting(false)
            }

            if let message = model.errorMessage {
                VStack(spacing: 16) {
                    Image(systemName: "wifi.exclamationmark")
                        .font(.system(size: 34, weight: .semibold))
                    Text("Discord を読み込めませんでした")
                        .font(.headline)
                    Text(message)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                    Button("再試行") {
                        model.reload()
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.indigo)
                }
                .padding(24)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .padding(32)
            }
        }
    }
}
