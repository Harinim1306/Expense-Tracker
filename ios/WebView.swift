import SwiftUI
import WebKit

struct TrackFlowWebView: UIViewRepresentable {
    let urlString: String
    @Binding var isLoading: Bool
    @Binding var errorMessage: String?

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeUIView(context: Context) -> WKWebView {
        let preferences = WKWebpagePreferences()
        preferences.allowsContentJavaScript = true

        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences = preferences
        config.allowsInlineMediaPlayback = true

        // Script message handler for native iOS haptics
        let contentController = WKUserContentController()
        contentController.add(context.coordinator, name: "hapticFeedback")
        contentController.add(context.coordinator, name: "scheduleNotification")
        config.userContentController = contentController

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.scrollView.bounces = true
        webView.allowsBackForwardNavigationGestures = true
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 247/255, green: 246/255, blue: 242/255, alpha: 1.0)
        webView.scrollView.backgroundColor = webView.backgroundColor

        // Native iOS Pull-to-Refresh
        let refreshControl = UIRefreshControl()
        refreshControl.tintColor = UIColor(red: 45/255, green: 106/255, blue: 79/255, alpha: 1.0)
        refreshControl.addTarget(context.coordinator, action: #selector(Coordinator.handleRefresh(_:)), for: .valueChanged)
        webView.scrollView.refreshControl = refreshControl

        context.coordinator.webView = webView
        context.coordinator.loadContent(webView: webView, urlString: urlString)

        NotificationCenter.default.addObserver(
            context.coordinator,
            selector: #selector(Coordinator.onReloadRequested),
            name: .reloadWebView,
            object: nil
        )

        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        // Dynamic updates if needed
    }

    class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        var parent: TrackFlowWebView
        weak var webView: WKWebView?

        init(_ parent: TrackFlowWebView) {
            self.parent = parent
        }

        func loadContent(webView: WKWebView, urlString: String) {
            if !urlString.isEmpty, let url = URL(string: urlString) {
                var request = URLRequest(url: url)
                request.timeoutInterval = 12
                webView.load(request)
            } else {
                // Fallback: Load bundled standalone.html from app bundle
                loadBundledHtml(webView: webView)
            }
        }

        func loadBundledHtml(webView: WKWebView) {
            if let path = Bundle.main.path(forResource: "standalone", ofType: "html") {
                let fileUrl = URL(fileURLWithPath: path)
                webView.loadFileURL(fileUrl, allowingReadAccessTo: fileUrl.deletingLastPathComponent())
            } else if let path = Bundle.main.path(forResource: "index", ofType: "html") {
                let fileUrl = URL(fileURLWithPath: path)
                webView.loadFileURL(fileUrl, allowingReadAccessTo: fileUrl.deletingLastPathComponent())
            } else {
                parent.errorMessage = "Could not find bundled HTML files or remote server."
            }
        }

        @objc func handleRefresh(_ sender: UIRefreshControl) {
            webView?.reload()
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                sender.endRefreshing()
            }
        }

        @objc func onReloadRequested() {
            if let webView = webView {
                loadContent(webView: webView, urlString: parent.urlString)
            }
        }

        // MARK: - WKNavigationDelegate
        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            DispatchQueue.main.async {
                self.parent.isLoading = true
                self.parent.errorMessage = nil
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            DispatchQueue.main.async {
                self.parent.isLoading = false
                self.parent.errorMessage = nil
                webView.scrollView.refreshControl?.endRefreshing()
            }
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            let nsError = error as NSError
            // If network connection failed and we have bundled html, fallback to bundled HTML
            if nsError.domain == NSURLErrorDomain {
                print("Remote URL unreachable. Falling back to local bundled HTML...")
                loadBundledHtml(webView: webView)
                return
            }

            DispatchQueue.main.async {
                self.parent.isLoading = false
                self.parent.errorMessage = error.localizedDescription
                webView.scrollView.refreshControl?.endRefreshing()
            }
        }

        // MARK: - Native Alerts & Prompts Bridge
        func webView(
            _ webView: WKWebView,
            runJavaScriptAlertPanelWithMessage message: String,
            initiatedByFrame frame: WKFrameInfo,
            completionHandler: @escaping () -> Void
        ) {
            let alert = UIAlertController(title: "TrackFlow", message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
            findTopViewController()?.present(alert, animated: true)
        }

        func webView(
            _ webView: WKWebView,
            runJavaScriptConfirmPanelWithMessage message: String,
            initiatedByFrame frame: WKFrameInfo,
            completionHandler: @escaping (Bool) -> Void
        ) {
            let alert = UIAlertController(title: "TrackFlow", message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
            alert.addAction(UIAlertAction(title: "Confirm", style: .default) { _ in completionHandler(true) })
            findTopViewController()?.present(alert, animated: true)
        }

        // MARK: - Script Messages from Web (Haptics & Notifications)
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            if message.name == "hapticFeedback" {
                let generator = UIImpactFeedbackGenerator(style: .medium)
                generator.impactOccurred()
            }
        }

        private func findTopViewController() -> UIViewController? {
            let keyWindow = UIApplication.shared.connectedScenes
                .filter { $0.activationState == .foregroundActive }
                .compactMap { $0 as? UIWindowScene }
                .first?.windows
                .filter { $0.isKeyWindow }.first

            var topController = keyWindow?.rootViewController
            while let presented = topController?.presentedViewController {
                topController = presented
            }
            return topController
        }
    }
}
