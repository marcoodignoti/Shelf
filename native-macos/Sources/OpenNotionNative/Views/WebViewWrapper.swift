import SwiftUI
import WebKit

struct WebViewWrapper: NSViewRepresentable {
    var url: URL?
    @Binding var canGoBack: Bool
    @Binding var canGoForward: Bool
    @Binding var isLoading: Bool
    var backTrigger: Int
    var forwardTrigger: Int
    var reloadTrigger: Int
    var onURLChange: (URL) -> Void
    var onTitleChange: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.allowsBackForwardNavigationGestures = true
        context.coordinator.attach(to: webView)
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        context.coordinator.parent = self
        context.coordinator.applyNavigationCommands(to: webView)

        guard let url else {
            return
        }

        if webView.url?.absoluteString != url.absoluteString {
            if url.isFileURL {
                webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
            } else {
                webView.load(URLRequest(url: url))
            }
        }
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        var parent: WebViewWrapper
        private var titleObservation: NSKeyValueObservation?
        private var urlObservation: NSKeyValueObservation?
        private var loadingObservation: NSKeyValueObservation?
        private var backObservation: NSKeyValueObservation?
        private var forwardObservation: NSKeyValueObservation?
        private var lastBackTrigger = 0
        private var lastForwardTrigger = 0
        private var lastReloadTrigger = 0

        init(_ parent: WebViewWrapper) {
            self.parent = parent
        }

        func attach(to webView: WKWebView) {
            webView.navigationDelegate = self
            titleObservation = webView.observe(\.title, options: [.new]) { [weak self] _, change in
                guard let title = change.newValue.flatMap({ $0 }) else {
                    return
                }
                DispatchQueue.main.async {
                    self?.parent.onTitleChange(title)
                }
            }
            urlObservation = webView.observe(\.url, options: [.new]) { [weak self] _, change in
                guard let url = change.newValue.flatMap({ $0 }) else {
                    return
                }
                DispatchQueue.main.async {
                    self?.parent.onURLChange(url)
                }
            }
            loadingObservation = webView.observe(\.isLoading, options: [.new]) { [weak self] _, change in
                DispatchQueue.main.async {
                    self?.parent.isLoading = change.newValue ?? false
                }
            }
            backObservation = webView.observe(\.canGoBack, options: [.new]) { [weak self] _, change in
                DispatchQueue.main.async {
                    self?.parent.canGoBack = change.newValue ?? false
                }
            }
            forwardObservation = webView.observe(\.canGoForward, options: [.new]) { [weak self] _, change in
                DispatchQueue.main.async {
                    self?.parent.canGoForward = change.newValue ?? false
                }
            }
        }

        func applyNavigationCommands(to webView: WKWebView) {
            if parent.backTrigger != lastBackTrigger {
                lastBackTrigger = parent.backTrigger
                if webView.canGoBack {
                    webView.goBack()
                }
            }

            if parent.forwardTrigger != lastForwardTrigger {
                lastForwardTrigger = parent.forwardTrigger
                if webView.canGoForward {
                    webView.goForward()
                }
            }

            if parent.reloadTrigger != lastReloadTrigger {
                lastReloadTrigger = parent.reloadTrigger
                webView.reload()
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            parent.canGoBack = webView.canGoBack
            parent.canGoForward = webView.canGoForward
            parent.isLoading = false
            if let title = webView.title {
                parent.onTitleChange(title)
            }
            if let url = webView.url {
                parent.onURLChange(url)
            }
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
            parent.isLoading = true
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            parent.isLoading = false
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            parent.isLoading = false
        }
    }
}
