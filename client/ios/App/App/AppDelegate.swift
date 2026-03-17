import UIKit
import Capacitor
import Firebase
import FirebaseMessaging
import UserNotifications

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    /// Read server URL from bundled capacitor.config.json; fall back to production.
    private lazy var serverURL: String = {
        let fallback = "https://cpoint-app-staging-739552904126.europe-west1.run.app"
        guard let path = Bundle.main.path(forResource: "capacitor.config", ofType: "json") else {
            NSLog("⚠️ capacitor.config.json not in bundle, using fallback URL")
            return fallback
        }
        do {
            let data = try Data(contentsOf: URL(fileURLWithPath: path))
            if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
               let server = json["server"] as? [String: Any],
               let url = server["url"] as? String,
               !url.isEmpty {
                let trimmed = url.hasSuffix("/") ? String(url.dropLast()) : url
                NSLog("✅ Server URL from capacitor.config.json: %@", trimmed)
                return trimmed
            }
        } catch {
            NSLog("⚠️ Failed to parse capacitor.config.json: %@", error.localizedDescription)
        }
        return fallback
    }()

    override init() {
        super.init()
        NSLog("🔴🔴🔴 AppDelegate init() called - object created 🔴🔴🔴")
        print("🔴 AppDelegate initialized")
    }

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        
        // CRITICAL DEBUG - This MUST show up
        NSLog("========================================")
        NSLog("CPOINT APP DELEGATE LAUNCHED!!!")
        NSLog("BUILD 39 - WITH UNIVERSAL LINK FIX")
        NSLog("========================================")
        print("🚀 App launching...")
        
        // Check if launched from Universal Link
        if let userActivityDict = launchOptions?[UIApplication.LaunchOptionsKey.userActivityDictionary] as? [String: Any],
           let userActivity = userActivityDict["UIApplicationLaunchOptionsUserActivityKey"] as? NSUserActivity,
           userActivity.activityType == NSUserActivityTypeBrowsingWeb,
           let url = userActivity.webpageURL {
            NSLog("🔗🔗🔗 APP LAUNCHED FROM UNIVERSAL LINK 🔗🔗🔗")
            NSLog("Launch URL: %@", url.absoluteString)
            UserDefaults.standard.set(url.absoluteString, forKey: "launchUniversalLink")
            UserDefaults.standard.synchronize()
        }
        
        // Sync badge with server when app launches
        syncBadgeWithServer()
        
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

    // MARK: - App Lifecycle - Badge Sync
    
    func applicationDidBecomeActive(_ application: UIApplication) {
        // Sync badge when app comes to foreground
        syncBadgeWithServer()
    }
    
    // MARK: - Badge Sync with Server
    
    private func syncBadgeWithServer() {
        NSLog("📛 Syncing badge with server...")
        
        guard let url = URL(string: "\(serverURL)/api/notifications/badge-count") else {
            NSLog("📛 Invalid badge URL")
            return
        }
        
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        
        let task = URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                NSLog("📛 Badge sync error: %@", error.localizedDescription)
                return
            }
            
            guard let data = data else {
                NSLog("📛 No data from badge sync")
                return
            }
            
            do {
                if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let badgeCount = json["badge_count"] as? Int {
                    DispatchQueue.main.async {
                        UIApplication.shared.applicationIconBadgeNumber = badgeCount
                        NSLog("📛 Badge synced to %d", badgeCount)
                    }
                }
            } catch {
                NSLog("📛 Badge JSON parse error: %@", error.localizedDescription)
            }
        }
        task.resume()
    }

    // MARK: - Capacitor Deep Links & Universal Links

    // Handle custom URL schemes (cpoint://) and Google Sign-In OAuth callbacks
    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        NSLog("🔗🔗🔗 URL SCHEME RECEIVED 🔗🔗🔗")
        NSLog("URL: %@", url.absoluteString)
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    // Handle Universal Links (https://app.c-point.co/...)
    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        NSLog("🔗🔗🔗 UNIVERSAL LINK RECEIVED 🔗🔗🔗")
        NSLog("Activity type: %@", userActivity.activityType)
        
        if userActivity.activityType == NSUserActivityTypeBrowsingWeb,
           let url = userActivity.webpageURL {
            NSLog("Universal Link URL: %@", url.absoluteString)
            print("🔗 Universal Link: \(url.absoluteString)")
            
            // Store the URL so we can retrieve it if needed
            UserDefaults.standard.set(url.absoluteString, forKey: "lastUniversalLink")
            UserDefaults.standard.synchronize()
        }
        
        // Forward to Capacitor
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
        
        // Badge will be updated by the web app when marking notification as read
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
