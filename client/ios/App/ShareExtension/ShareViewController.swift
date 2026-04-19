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
        label.text = "Adding to C-Point…"
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
            await finishWithError("No supported photos, videos, audio, PDFs, or links.")
            return
        }

        let trimmed = Array(manifestItems.prefix(kMaxItems))
        let manifest: [String: Any] = ["version": 2, "items": trimmed]
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
        let audioTypes = [
            UTType.audio.identifier,
            UTType.mp3.identifier,
            UTType.mpeg4Audio.identifier,
            "public.aiff-audio",
            "public.wav",
            "com.apple.coreaudio-format",
        ]
        for t in audioTypes where provider.hasItemConformingToTypeIdentifier(t) {
            if let r = await loadAudio(provider: provider, typeIdentifier: t, incoming: incoming, indexBox: indexBox) {
                return r
            }
        }
        if provider.hasItemConformingToTypeIdentifier(UTType.pdf.identifier) {
            if let r = await loadPdf(provider: provider, incoming: incoming, indexBox: indexBox) {
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
        if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
            if let r = await loadShareUrl(provider: provider) {
                return r
            }
        }
        if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
            if let r = await loadSharePlainText(provider: provider) {
                return r
            }
        }
        return nil
    }

    private func loadShareUrl(provider: NSItemProvider) async -> [[String: Any]]? {
        await withCheckedContinuation { (cont: CheckedContinuation<[[String: Any]]?, Never>) in
            provider.loadItem(forTypeIdentifier: UTType.url.identifier as String, options: nil) { item, err in
                if err != nil {
                    cont.resume(returning: nil)
                    return
                }
                guard let u = item as? URL else {
                    cont.resume(returning: nil)
                    return
                }
                let s = u.absoluteString
                guard s.hasPrefix("http://") || s.hasPrefix("https://") else {
                    cont.resume(returning: nil)
                    return
                }
                cont.resume(returning: [["filename": "", "mimeType": "text/plain", "kind": "link", "url": s]])
            }
        }
    }

    private func loadSharePlainText(provider: NSItemProvider) async -> [[String: Any]]? {
        await withCheckedContinuation { (cont: CheckedContinuation<[[String: Any]]?, Never>) in
            provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { item, err in
                if err != nil {
                    cont.resume(returning: nil)
                    return
                }
                guard let text = item as? String, !text.isEmpty else {
                    cont.resume(returning: nil)
                    return
                }
                let urls = Self.extractHttpUrls(from: text)
                guard !urls.isEmpty else {
                    cont.resume(returning: nil)
                    return
                }
                let rows: [[String: Any]] = urls.map { u in
                    ["filename": "", "mimeType": "text/plain", "kind": "link", "url": u]
                }
                cont.resume(returning: rows)
            }
        }
    }

    private static func extractHttpUrls(from text: String) -> [String] {
        let pattern = "https?://[^\\s<>\"]+"
        guard let re = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive) else { return [] }
        let range = NSRange(text.startIndex..., in: text)
        let matches = re.matches(in: text, options: [], range: range)
        var out: [String] = []
        var seen = Set<String>()
        for m in matches.prefix(kMaxItems) {
            guard m.numberOfRanges >= 1, let r = Range(m.range(at: 0), in: text) else { continue }
            var s = String(text[r])
            while let last = s.last {
                let ch = String(last)
                if [".", ",", ")", ";", "]", "!", "?"].contains(ch) {
                    s.removeLast()
                } else {
                    break
                }
            }
            if !seen.contains(s) {
                seen.insert(s)
                out.append(s)
            }
        }
        return out
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

    private func loadAudio(provider: NSItemProvider, typeIdentifier: String, incoming: URL, indexBox: IndexBox) async -> [[String: Any]]? {
        await withCheckedContinuation { (cont: CheckedContinuation<[[String: Any]]?, Never>) in
            provider.loadFileRepresentation(forTypeIdentifier: typeIdentifier) { url, err in
                guard let url = url, err == nil else {
                    cont.resume(returning: nil)
                    return
                }
                let ext = url.pathExtension.isEmpty ? "m4a" : url.pathExtension
                let name = "item_\(indexBox.value).\(ext)"
                indexBox.value += 1
                let dest = incoming.appendingPathComponent(name)
                do {
                    if FileManager.default.fileExists(atPath: dest.path) {
                        try FileManager.default.removeItem(at: dest)
                    }
                    try FileManager.default.copyItem(at: url, to: dest)
                    cont.resume(returning: [["filename": name, "mimeType": self.mimeForFile(at: dest), "kind": "audio"]])
                } catch {
                    cont.resume(returning: nil)
                }
            }
        }
    }

    private func loadPdf(provider: NSItemProvider, incoming: URL, indexBox: IndexBox) async -> [[String: Any]]? {
        await withCheckedContinuation { (cont: CheckedContinuation<[[String: Any]]?, Never>) in
            provider.loadFileRepresentation(forTypeIdentifier: UTType.pdf.identifier) { url, err in
                guard let url = url, err == nil else {
                    cont.resume(returning: nil)
                    return
                }
                let ext = url.pathExtension.isEmpty ? "pdf" : url.pathExtension
                let name = "item_\(indexBox.value).\(ext)"
                indexBox.value += 1
                let dest = incoming.appendingPathComponent(name)
                do {
                    if FileManager.default.fileExists(atPath: dest.path) {
                        try FileManager.default.removeItem(at: dest)
                    }
                    try FileManager.default.copyItem(at: url, to: dest)
                    cont.resume(returning: [["filename": name, "mimeType": "application/pdf", "kind": "document"]])
                } catch {
                    cont.resume(returning: nil)
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
                let isAud = ["m4a", "mp3", "aac", "wav", "flac", "caf", "aiff", "aif", "ogg", "opus"].contains(ext)
                let isPdf = ext == "pdf"
                guard isVid || isImg || isAud || isPdf else {
                    cont.resume(returning: nil)
                    return
                }
                let fallbackExt: String
                if isVid { fallbackExt = "mp4" } else if isAud { fallbackExt = "m4a" } else if isPdf { fallbackExt = "pdf" } else { fallbackExt = "jpg" }
                let name = "item_\(indexBox.value).\(url.pathExtension.isEmpty ? fallbackExt : url.pathExtension)"
                indexBox.value += 1
                let dest = incoming.appendingPathComponent(name)
                do {
                    if FileManager.default.fileExists(atPath: dest.path) {
                        try FileManager.default.removeItem(at: dest)
                    }
                    try FileManager.default.copyItem(at: url, to: dest)
                    let kind: String
                    if isVid { kind = "video" } else if isAud { kind = "audio" } else if isPdf { kind = "document" } else { kind = "image" }
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
        case "pdf": return "application/pdf"
        case "m4a": return "audio/mp4"
        case "mp3": return "audio/mpeg"
        case "aac": return "audio/aac"
        case "wav": return "audio/wav"
        case "caf": return "audio/x-caf"
        case "flac": return "audio/flac"
        case "ogg", "opus": return "audio/ogg"
        case "aiff", "aif": return "audio/aiff"
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

        // Critical ordering: call completeRequest FIRST and open the host app
        // INSIDE the completion handler. The completion handler fires after the
        // share sheet has dismissed in the source app (Instagram, X, …), which
        // lets that app finish its dismissal animation cleanly. If we instead
        // called UIApplication.open first, iOS would foreground C-Point while
        // the source app is mid-dismissal, preempting its scene transition and
        // leaving it visually frozen on the share UI.
        //
        // `self` (and therefore the responder chain) is still valid inside the
        // completion handler even though the extension is tearing down — that's
        // what makes the responder-chain open work.
        extensionContext?.completeRequest(returningItems: nil) { [weak self] _ in
            guard let self = self else { return }
            if self.openHostAppViaResponderChainSync(url) {
                NSLog("ShareExtension: UIApplication.open fired via responder chain after completeRequest")
            } else {
                // Last-resort fallback. The extension is already dismissed at this point,
                // so the source app's animation has completed.
                self.extensionContext?.open(url, completionHandler: nil)
                NSLog("ShareExtension: fallback extensionContext.open fired after completeRequest")
            }
        }
    }

    /// Walks the responder chain to find UIApplication and calls open(_:options:completionHandler:)
    /// without blocking on its result. Returns whether a UIApplication was found.
    private func openHostAppViaResponderChainSync(_ url: URL) -> Bool {
        var responder: UIResponder? = self
        while let current = responder {
            if let application = current as? UIApplication {
                application.open(url, options: [:], completionHandler: nil)
                return true
            }
            responder = current.next
        }
        NSLog("ShareExtension: No UIApplication in responder chain for fallback open")
        return false
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
