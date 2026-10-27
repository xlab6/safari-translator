//
//  ViewController.swift
//  Safari Translator
//

import Cocoa
import SafariServices
import WebKit

class ViewController: NSViewController, WKNavigationDelegate, WKScriptMessageHandler {

    @IBOutlet var webView: WKWebView!

    /// Read the identifier from the embedded extension so changing the bundle
    /// identifiers in Xcode does not require editing this file.
    private lazy var extensionBundleIdentifier: String = {
        if let pluginsURL = Bundle.main.builtInPlugInsURL,
           let items = try? FileManager.default.contentsOfDirectory(
               at: pluginsURL,
               includingPropertiesForKeys: nil
           ),
           let appexURL = items.first(where: { $0.pathExtension == "appex" }),
           let appex = Bundle(url: appexURL),
           let identifier = appex.bundleIdentifier {
            return identifier
        }
        return (Bundle.main.bundleIdentifier ?? "cn.oxzz.safari-translator") + ".Extension"
    }()

    override func viewDidLoad() {
        super.viewDidLoad()

        self.webView.navigationDelegate = self
        self.webView.configuration.userContentController.add(self, name: "controller")

        if let page = Bundle.main.url(forResource: "Main", withExtension: "html"),
           let resources = Bundle.main.resourceURL {
            self.webView.loadFileURL(page, allowingReadAccessTo: resources)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) { state, error in
            DispatchQueue.main.async {
                guard let state = state, error == nil else {
                    // Unknown state: keep the neutral "enable the extension" copy.
                    webView.evaluateJavaScript("show(null, true)")
                    return
                }

                if #available(macOS 13, *) {
                    webView.evaluateJavaScript("show(\(state.isEnabled), true)")
                } else {
                    webView.evaluateJavaScript("show(\(state.isEnabled), false)")
                }
            }
        }
    }

    // The GitHub address in the welcome window opens in the default browser
    // instead of navigating the panel away from its own page.
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if navigationAction.targetFrame?.isMainFrame != false,
           let url = navigationAction.request.url,
           let scheme = url.scheme, scheme == "http" || scheme == "https" {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? String, body == "open-preferences" else {
            return
        }

        SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { error in
            if let error = error {
                DispatchQueue.main.async {
                    let alert = NSAlert()
                    alert.messageText = "无法打开 Safari 设置"
                    alert.informativeText = error.localizedDescription
                    alert.alertStyle = .warning
                    alert.runModal()
                }
                return
            }

            DispatchQueue.main.async {
                NSApplication.shared.terminate(nil)
            }
        }
    }
}
