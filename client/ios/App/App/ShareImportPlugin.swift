import Foundation
import Capacitor

private let kAppGroupId = "group.co.cpoint.app"
private let kIncomingSubdir = "IncomingShare"
private let kImportedSubdir = "ImportedShare"

@objc(ShareImportPlugin)
public class ShareImportPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ShareImportPlugin"
    public let jsName = "ShareImport"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getPending", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearPending", returnType: CAPPluginReturnPromise),
    ]

    @objc func getPending(_ call: CAPPluginCall) {
        guard let base = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: kAppGroupId) else {
            call.reject("Shared App Group container is unavailable.")
            return
        }
        let manifestURL = base.appendingPathComponent("\(kIncomingSubdir)/manifest.json")
        guard let data = try? Data(contentsOf: manifestURL),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let rawItems = json["items"] as? [[String: Any]] else {
            call.resolve(["items": []])
            return
        }

        let imported = FileManager.default.temporaryDirectory.appendingPathComponent(kImportedSubdir, isDirectory: true)
        do {
            if FileManager.default.fileExists(atPath: imported.path) {
                try FileManager.default.removeItem(at: imported)
            }
            try FileManager.default.createDirectory(at: imported, withIntermediateDirectories: true)
        } catch {
            call.reject("Could not prepare imported share files.", nil, error)
            return
        }

        var out: [[String: Any]] = []
        for item in rawItems {
            guard let name = item["filename"] as? String, !name.isEmpty else { continue }
            let sourceURL = base.appendingPathComponent("\(kIncomingSubdir)/\(name)")
            let mime = item["mimeType"] as? String ?? "application/octet-stream"
            let kind = item["kind"] as? String ?? "file"
            guard FileManager.default.fileExists(atPath: sourceURL.path) else { continue }

            let destURL = imported.appendingPathComponent(name)
            do {
                if FileManager.default.fileExists(atPath: destURL.path) {
                    try FileManager.default.removeItem(at: destURL)
                }
                try FileManager.default.copyItem(at: sourceURL, to: destURL)
                out.append(["path": destURL.path, "mimeType": mime, "kind": kind])
            } catch {
                NSLog("ShareImportPlugin copy failed for %@: %@", name, error.localizedDescription)
            }
        }
        call.resolve(["items": out])
    }

    @objc func clearPending(_ call: CAPPluginCall) {
        if let base = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: kAppGroupId) {
            let incoming = base.appendingPathComponent(kIncomingSubdir, isDirectory: true)
            try? FileManager.default.removeItem(at: incoming)
        }
        let imported = FileManager.default.temporaryDirectory.appendingPathComponent(kImportedSubdir, isDirectory: true)
        try? FileManager.default.removeItem(at: imported)
        call.resolve()
    }
}
