import UIKit
import UniformTypeIdentifiers

private let kAppGroupId = "group.co.cpoint.app"
private let kIncomingSubdir = "IncomingShare"
private let kMaxItems = 5

/// Reference type so NSItemProvider completion handlers can update the index (Swift forbids capturing `inout` in escaping closures).
private final class IndexBox {
    var value = 0
}

final class ShareViewController: UIViewController {

    private let appGroupId = kAppGroupId

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        let label = UILabel()
        label.translatesAutoresizingMaskIntoConstraints = false
        label.text = "Adding to C.Point…"
        label.textAlignment = .center
        label.textColor = .label
        label.font = .preferredFont(forTextStyle: .body)
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
        ])
        Task { await runSharePipeline() }
    }

    private func runSharePipeline() async {
        guard let base = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupId) else {
            NSLog("ShareExtension: App Group unavailable for %@", appGroupId)
            await finishWithError("App Group is not available. Rebuild the app with the Share Extension target.")
            return
        }
        let incoming = base.appendingPathComponent(kIncomingSubdir, isDirectory: true)
        try? FileManager.default.removeItem(at: incoming)
        do {
            try FileManager.default.createDirectory(at: incoming, withIntermediateDirectories: true)
        } catch {
            NSLog("ShareExtension: Failed to create incoming directory: %@", error.localizedDescription)
            await finishWithError("Could not prepare shared storage.")
            return
        }

        guard let items = extensionContext?.inputItems as? [NSExtensionItem], !items.isEmpty else {
            NSLog("ShareExtension: No extension input items")
            await finishWithError("Nothing to share.")
            return
        }

        var manifestItems: [[String: Any]] = []
        let indexBox = IndexBox()

        outer: for extItem in items {
            guard let attachments = extItem.attachments else { continue }
            for provider in attachments {
                if manifestItems.count >= kMaxItems { break outer }
                if let entries = await copyFromProvider(provider, to: incoming, indexBox: indexBox) {
                    manifestItems.append(contentsOf: entries)
                }
                if manifestItems.count >= kMaxItems { break outer }
            }
        }

        if manifestItems.isEmpty {
            NSLog("ShareExtension: No supported items were copied")
            await finishWithError("No supported photos or videos.")
            return
        }

        let trimmed = Array(manifestItems.prefix(kMaxItems))
        let manifest: [String: Any] = ["version": 1, "items": trimmed]
        guard let json = try? JSONSerialization.data(withJSONObject: manifest, options: []) else {
            NSLog("ShareExtension: Failed to serialize manifest for %d items", trimmed.count)
            await finishWithError("Could not build manifest.")
            return
        }
        let manifestURL = incoming.appendingPathComponent("manifest.json")
        do {
            try json.write(to: manifestURL, options: .atomic)
            NSLog("ShareExtension: Wrote manifest with %d item(s) to %@", trimmed.count, manifestURL.path)
        } catch {
            NSLog("ShareExtension: Failed to save manifest: %@", error.localizedDescription)
            await finishWithError("Could not save manifest.")
            return
        }

        await openHostApp()
    }

    private func copyFromProvider(_ provider: NSItemProvider, to incoming: URL, indexBox: IndexBox) async -> [[String: Any]]? {
        let movieTypes = [
            UTType.movie.identifier,
            "public.mpeg-4",
            "com.apple.quicktime-movie",
            "public.avi",
        ]
        for t in movieTypes where provider.hasItemConformingToTypeIdentifier(t) {
            if let r = await loadMovie(provider: provider, typeIdentifier: t, incoming: incoming, indexBox: indexBox) {
                return r
            }
        }
        if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
            if let r = await loadImage(provider: provider, incoming: incoming, indexBox: indexBox) {
                return r
            }
        }
        if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
            if let r = await loadFileURL(provider: provider, incoming: incoming, indexBox: indexBox) {
                return r
            }
        }
        return nil
    }

    private func loadImage(provider: NSItemProvider, incoming: URL, indexBox: IndexBox) async -> [[String: Any]]? {
        await withCheckedContinuation { (cont: CheckedContinuation<[[String: Any]]?, Never>) in
            provider.loadFileRepresentation(forTypeIdentifier: UTType.image.identifier) { url, err in
                if let url = url, err == nil {
                    let ext = url.pathExtension.isEmpty ? "jpg" : url.pathExtension
                    let name = "item_\(indexBox.value).\(ext)"
                    indexBox.value += 1
                    let dest = incoming.appendingPathComponent(name)
                    do {
                        if FileManager.default.fileExists(atPath: dest.path) {
                            try FileManager.default.removeItem(at: dest)
                        }
                        try FileManager.default.copyItem(at: url, to: dest)
                        cont.resume(returning: [["filename": name, "mimeType": self.mimeForFile(at: dest), "kind": "image"]])
                    } catch {
                        cont.resume(returning: nil)
                    }
                    return
                }
                provider.loadObject(ofClass: UIImage.self) { obj, _ in
                    guard let img = obj as? UIImage, let data = img.jpegData(compressionQuality: 0.92) else {
                        cont.resume(returning: nil)
                        return
                    }
                    let name = "item_\(indexBox.value).jpg"
                    indexBox.value += 1
                    let dest = incoming.appendingPathComponent(name)
                    do {
                        try data.write(to: dest, options: .atomic)
                        cont.resume(returning: [["filename": name, "mimeType": "image/jpeg", "kind": "image"]])
                    } catch {
                        cont.resume(returning: nil)
                    }
                }
            }
        }
    }

    private func loadMovie(provider: NSItemProvider, typeIdentifier: String, incoming: URL, indexBox: IndexBox) async -> [[String: Any]]? {
        await withCheckedContinuation { (cont: CheckedContinuation<[[String: Any]]?, Never>) in
            provider.loadFileRepresentation(forTypeIdentifier: typeIdentifier) { url, err in
                guard let url = url, err == nil else {
                    cont.resume(returning: nil)
                    return
                }
                let ext = url.pathExtension.isEmpty ? "mov" : url.pathExtension
                let name = "item_\(indexBox.value).\(ext)"
                indexBox.value += 1
                let dest = incoming.appendingPathComponent(name)
                do {
                    if FileManager.default.fileExists(atPath: dest.path) {
                        try FileManager.default.removeItem(at: dest)
                    }
                    try FileManager.default.copyItem(at: url, to: dest)
                    cont.resume(returning: [["filename": name, "mimeType": self.mimeForFile(at: dest), "kind": "video"]])
                } catch {
                    cont.resume(returning: nil)
                }
            }
        }
    }

    private func loadFileURL(provider: NSItemProvider, incoming: URL, indexBox: IndexBox) async -> [[String: Any]]? {
        // Prefer loadFileRepresentation over loadItem — the latter triggers noisy
        // system logs ("nil expectedValueClass allowing …") and is less predictable for file URLs.
        await withCheckedContinuation { (cont: CheckedContinuation<[[String: Any]]?, Never>) in
            provider.loadFileRepresentation(forTypeIdentifier: UTType.fileURL.identifier) { url, err in
                guard let url = url, err == nil else {
                    cont.resume(returning: nil)
                    return
                }
                let ext = url.pathExtension.lowercased()
                let isVid = ["mov", "mp4", "m4v", "avi", "mkv", "webm"].contains(ext)
                let isImg = ["jpg", "jpeg", "png", "heic", "heif", "gif", "webp"].contains(ext)
                guard isVid || isImg else {
                    cont.resume(returning: nil)
                    return
                }
                let name = "item_\(indexBox.value).\(url.pathExtension.isEmpty ? (isVid ? "mp4" : "jpg") : url.pathExtension)"
                indexBox.value += 1
                let dest = incoming.appendingPathComponent(name)
                do {
                    if FileManager.default.fileExists(atPath: dest.path) {
                        try FileManager.default.removeItem(at: dest)
                    }
                    try FileManager.default.copyItem(at: url, to: dest)
                    let kind = isVid ? "video" : "image"
                    cont.resume(returning: [["filename": name, "mimeType": self.mimeForFile(at: dest), "kind": kind]])
                } catch {
                    cont.resume(returning: nil)
                }
            }
        }
    }

    private func mimeForFile(at url: URL) -> String {
        let ext = url.pathExtension.lowercased()
        switch ext {
        case "jpg", "jpeg": return "image/jpeg"
        case "png": return "image/png"
        case "heic", "heif": return "image/heic"
        case "gif": return "image/gif"
        case "mp4", "m4v": return "video/mp4"
        case "mov": return "video/quicktime"
        case "webm": return "video/webm"
        default: return "application/octet-stream"
        }
    }

    @MainActor
    private func openHostApp() {
        // Unique query so JS can dedupe appUrlOpen repeats without blocking a later share in the session.
        let incoming = "cpoint://share/incoming?t=\(UUID().uuidString)"
        guard let url = URL(string: incoming) else {
            extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
            return
        }
        NSLog("ShareExtension: Attempting to open host app with %@", url.absoluteString)
        extensionContext?.open(url, completionHandler: { [weak self] success in
            NSLog("ShareExtension: extensionContext.open success=%@", success ? "true" : "false")
            guard let self else { return }
            if success {
                self.extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
                return
            }

            // extensionContext.open can fail on some OS/simulator builds. Do not use deprecated
            // UIApplication.openURL(_:) — UIKit forces it to return false on current iOS.
            self.openHostAppViaResponderChain(url) { [weak self] fallbackSuccess in
                guard let self else { return }
                if fallbackSuccess {
                    NSLog("ShareExtension: UIApplication.open fallback succeeded")
                    self.extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
                    return
                }
                NSLog("ShareExtension: Host app open failed (extensionContext + UIApplication fallback)")
                Task { @MainActor in
                    await self.finishWithError("C.Point could not open from the share sheet. Open C.Point, then try sharing again.")
                }
            }
        })
    }

    /// Finds UIApplication on the responder chain and opens the URL with the non-deprecated API.
    private func openHostAppViaResponderChain(_ url: URL, completion: @escaping (Bool) -> Void) {
        var responder: UIResponder? = self
        while let current = responder {
            if let application = current as? UIApplication {
                application.open(url, options: [:], completionHandler: { success in
                    NSLog("ShareExtension: UIApplication.open completion=%@", success ? "true" : "false")
                    completion(success)
                })
                return
            }
            responder = current.next
        }
        NSLog("ShareExtension: No UIApplication in responder chain for fallback open")
        completion(false)
    }

    @MainActor
    private func finishWithError(_ message: String) {
        let alert = UIAlertController(title: "Could not share", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { [weak self] _ in
            let err = NSError(domain: "ShareExtension", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
            self?.extensionContext?.cancelRequest(withError: err)
        })
        present(alert, animated: true)
    }
}
