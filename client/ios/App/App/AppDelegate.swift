import UIKit
import Capacitor
import Firebase
import FirebaseMessaging
import UserNotifications

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?
    private let serverURL = "https://app.c-point.co"
    
    override init() {
        super.init()
        NSLog("🔴🔴🔴 AppDelegate init() called - object created 🔴🔴🔴")
        print("🔴 AppDelegate initialized")
    }

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        
        // CRITICAL DEBUG - This MUST show up
        NSLog("========================================")
        NSLog("CPOINT APP DELEGATE LAUNCHED!!!")
        NSLog("BUILD 38 - WITH BADGE CLEARING")
        NSLog("========================================")
        print("🚀 App launching...")
        
        // Clear badge on app launch
        application.applicationIconBadgeNumber = 0
        NSLog("📛 Badge cleared on launch")
        
        // 1. Initialize Firebase (optional - for FCM token conversion)
        FirebaseApp.configure()
        NSLog("Firebase configured")
        print("✅ Firebase configured")
        
        // 2. Set FCM delegate to receive token updates
        Messaging.messaging().delegate = self
        print("✅ FCM delegate set")
        
        // 3. Set notification center delegate
        UNUserNotificationCenter.current().delegate = self
        
        // 4. Request authorization and register for notifications
        let authOptions: UNAuthorizationOptions = [.alert, .badge, .sound]
        UNUserNotificationCenter.current().requestAuthorization(
            options: authOptions,
            completionHandler: { granted, error in
                if let error = error {
                    print("❌ Notification permission error: \(error.localizedDescription)")
                    return
                }
                
                if granted {
                    print("✅ Notification permission granted")
                    DispatchQueue.main.async {
                        application.registerForRemoteNotifications()
                        print("📱 Registering for remote notifications...")
                    }
                } else {
                    print("⚠️ Notification permission denied by user")
                }
            }
        )
        
        return true
    }

    // MARK: - APNs Token Registration

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let tokenString = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
        
        NSLog("🟢🟢🟢 APNS TOKEN RECEIVED 🟢🟢🟢")
        NSLog("Token: %@", tokenString)
        NSLog("Token length: %d characters", tokenString.count)
        print("✅ APNs device token received: \(tokenString)")
        
        // Pass to Firebase Messaging (Firebase will convert APNs token → FCM token)
        Messaging.messaging().apnsToken = deviceToken
        NSLog("Token passed to Firebase Messaging")
        print("✅ APNs token passed to Firebase Messaging")
        
        // ALSO send APNs token directly to server (in case Firebase/Capacitor bridge fails)
        sendTokenToServer(token: tokenString, tokenType: "apns")
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NSLog("🔴🔴🔴 APNS REGISTRATION FAILED 🔴🔴🔴")
        NSLog("Error: %@", error.localizedDescription)
        print("❌ Failed to register for remote notifications!")
        print("❌ Error: \(error)")
        print("❌ Error localized: \(error.localizedDescription)")
    }
    
    // MARK: - Direct Token Registration to Server
    
    private func sendTokenToServer(token: String, tokenType: String) {
        NSLog("📤 Sending %@ token directly to server...", tokenType)
        
        guard let url = URL(string: "\(serverURL)/api/push/register_fcm") else {
            NSLog("❌ Invalid server URL")
            return
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body: [String: Any] = [
            "token": token,
            "platform": "ios",
            "device_name": UIDevice.current.name,
            "token_type": tokenType
        ]
        
        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        } catch {
            NSLog("❌ Failed to serialize token request: %@", error.localizedDescription)
            return
        }
        
        let task = URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                NSLog("❌ Failed to send token to server: %@", error.localizedDescription)
                return
            }
            
            if let httpResponse = response as? HTTPURLResponse {
                NSLog("📤 Server response status: %d", httpResponse.statusCode)
                
                if httpResponse.statusCode == 200 {
                    NSLog("✅✅✅ TOKEN REGISTERED WITH SERVER ✅✅✅")
                    print("✅ Token successfully registered with server!")
                } else {
                    NSLog("⚠️ Server returned status %d", httpResponse.statusCode)
                    if let data = data, let responseStr = String(data: data, encoding: .utf8) {
                        NSLog("Server response: %@", responseStr)
                    }
                }
            }
        }
        task.resume()
    }

    // MARK: - App Lifecycle - Badge Clearing
    
    func applicationDidBecomeActive(_ application: UIApplication) {
        // Clear badge when app comes to foreground
        application.applicationIconBadgeNumber = 0
        NSLog("📛 Badge cleared on become active")
        print("📛 Badge cleared - app became active")
    }
    
    func applicationWillEnterForeground(_ application: UIApplication) {
        // Also clear when entering foreground
        application.applicationIconBadgeNumber = 0
        NSLog("📛 Badge cleared on enter foreground")
    }

    // MARK: - Capacitor Deep Links

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }
}

// MARK: - UNUserNotificationCenterDelegate

extension AppDelegate: UNUserNotificationCenterDelegate {
    
    // Called when notification arrives while app is in FOREGROUND
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        
        let userInfo = notification.request.content.userInfo
        print("📬 Notification received in foreground: \(userInfo)")
        
        // Show banner, sound, and badge even when app is open
        if #available(iOS 14.0, *) {
            completionHandler([.list, .banner, .sound, .badge])
        } else {
            completionHandler([.alert, .sound, .badge])
        }
    }
    
    // Called when user TAPS on a notification
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        
        let userInfo = response.notification.request.content.userInfo
        print("👆 User tapped notification: \(userInfo)")
        
        // Clear badge when notification is tapped
        DispatchQueue.main.async {
            UIApplication.shared.applicationIconBadgeNumber = 0
            NSLog("📛 Badge cleared on notification tap")
        }
        
        completionHandler()
    }
}

// MARK: - MessagingDelegate

extension AppDelegate: MessagingDelegate {
    
    // Called when FCM token is generated or refreshed
    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        NSLog("🔥🔥🔥 FCM DELEGATE CALLED 🔥🔥🔥")
        
        guard let token = fcmToken else {
            NSLog("WARNING: FCM token is nil")
            print("⚠️ FCM token is nil")
            return
        }
        
        NSLog("FCM TOKEN RECEIVED: %@", token)
        NSLog("Token length: %d", token.count)
        print("🔥 FCM Registration Token: \(token)")
        print("🔥 Token length: \(token.count) characters")
        
        // Post to NotificationCenter so JavaScript can pick it up
        NotificationCenter.default.post(
            name: Notification.Name("FCMToken"),
            object: nil,
            userInfo: ["token": token]
        )
        
        NSLog("FCM token posted to NotificationCenter")
        print("✅ FCM token posted to NotificationCenter")
        
        // ALSO send FCM token directly to server
        sendFCMTokenToServer(token: token)
    }
    
    private func sendFCMTokenToServer(token: String) {
        NSLog("📤 Sending FCM token directly to server...")
        
        guard let url = URL(string: "\(serverURL)/api/push/register_fcm") else {
            NSLog("❌ Invalid server URL")
            return
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body: [String: Any] = [
            "token": token,
            "platform": "ios",
            "device_name": UIDevice.current.name,
            "token_type": "fcm"
        ]
        
        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        } catch {
            NSLog("❌ Failed to serialize FCM token request: %@", error.localizedDescription)
            return
        }
        
        let task = URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                NSLog("❌ Failed to send FCM token to server: %@", error.localizedDescription)
                return
            }
            
            if let httpResponse = response as? HTTPURLResponse {
                NSLog("📤 FCM token server response: %d", httpResponse.statusCode)
                
                if httpResponse.statusCode == 200 {
                    NSLog("✅✅✅ FCM TOKEN REGISTERED WITH SERVER ✅✅✅")
                } else {
                    NSLog("⚠️ FCM token registration returned status %d", httpResponse.statusCode)
                }
            }
        }
        task.resume()
    }
}
