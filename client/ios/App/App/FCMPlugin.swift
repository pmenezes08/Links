import Foundation
import Capacitor
import FirebaseMessaging

@objc(FCMPlugin)
public class FCMPlugin: CAPPlugin {
    
    private var fcmToken: String?
    
    override public func load() {
        // Listen for FCM token updates
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(self.fcmTokenRefreshed(_:)),
            name: Notification.Name("FCMTokenRefresh"),
            object: nil
        )
    }
    
    @objc func fcmTokenRefreshed(_ notification: Notification) {
        if let token = notification.userInfo?["token"] as? String {
            self.fcmToken = token
            print("🔥 FCMPlugin: Token received: \(token.prefix(20))...")
            
            // Notify JavaScript
            self.notifyListeners("tokenReceived", data: ["token": token])
        }
    }
    
    @objc func getToken(_ call: CAPPluginCall) {
        // Try to get current token from Firebase
        Messaging.messaging().token { token, error in
            if let error = error {
                print("❌ FCMPlugin: Error fetching token: \(error)")
                call.reject("Error getting FCM token", "\(error)")
                return
            }
            
            if let token = token {
                print("✅ FCMPlugin: Returning token: \(token.prefix(20))...")
                self.fcmToken = token
                call.resolve(["token": token])
            } else {
                print("⚠️  FCMPlugin: No token available yet")
                call.resolve(["token": NSNull()])
            }
        }
    }
    
    @objc func deleteToken(_ call: CAPPluginCall) {
        Messaging.messaging().deleteToken { error in
            if let error = error {
                call.reject("Error deleting token", "\(error)")
                return
            }
            self.fcmToken = nil
            call.resolve()
        }
    }
    
    deinit {
        NotificationCenter.default.removeObserver(self)
    }
}
