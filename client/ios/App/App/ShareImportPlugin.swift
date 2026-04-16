import Foundation
import Capacitor

private let kAppGroupId = "group.co.cpoint.app"
private let kIncomingSubdir = "IncomingShare"

@objc(ShareImportPlugin)
public class ShareImportPlugin: CAPPlugin {

    @objc func getPending(_ call: CAPPluginCall) {
        guard let base = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: kAppGroupId) else {
            call.resolve(["items": []])
            return
        }
        let manifestURL = base.appendingPathComponent("\(kIncomingSubdir)/manifest.json")
        guard let data = try? Data(contentsOf: manifestURL),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let rawItems = json["items"] as? [[String: Any]] else {
            call.resolve(["items": []])
            return
        }
        var out: [[String: Any]] = []
        for item in rawItems {
            guard let name = item["filename"] as? String, !name.isEmpty else { continue }
            let path = base.appendingPathComponent("\(kIncomingSubdir)/\(name)").path
            let mime = item["mimeType"] as? String ?? "application/octet-stream"
            let kind = item["kind"] as? String ?? "file"
            if FileManager.default.fileExists(atPath: path) {
                out.append(["path": path, "mimeType": mime, "kind": kind])
            }
        }
        call.resolve(["items": out])
    }

    @objc func clearPending(_ call: CAPPluginCall) {
        guard let base = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: kAppGroupId) else {
            call.resolve()
            return
        }
        let incoming = base.appendingPathComponent(kIncomingSubdir, isDirectory: true)
        try? FileManager.default.removeItem(at: incoming)
        call.resolve()
    }
}
