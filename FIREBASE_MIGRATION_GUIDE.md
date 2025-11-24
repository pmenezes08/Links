# 🔥 Firebase Cloud Messaging Setup Guide

## ✅ What You'll Get
- ✅ iOS push notifications that **just work**
- ✅ No cryptography version issues
- ✅ Android support (future-ready)
- ✅ Automatic token management
- ✅ Free for your scale (10M messages/month)
- ✅ Analytics dashboard

**Time to complete:** 30-40 minutes

---

## Part 1: Firebase Console Setup (10 minutes)

### Step 1: Create Firebase Project

1. Go to https://console.firebase.google.com
2. Click **"Add project"**
3. Project name: **"C-Point"** (or your preferred name)
4. Disable Google Analytics (optional, can enable later)
5. Click **"Create project"**

### Step 2: Add iOS App

1. In Firebase console, click ⚙️ (Project Settings)
2. Click **"Add app"** → Select **iOS**
3. Fill in:
   - **iOS bundle ID:** `co.cpoint.app` (MUST match your Xcode project)
   - **App nickname:** C-Point iOS
   - **App Store ID:** (skip for now)
4. Click **"Register app"**

### Step 3: Download Config Files

1. **Download `GoogleService-Info.plist`**
   - Save it, you'll need it for iOS app
   
2. **Download Server Credentials:**
   - In Firebase console → Project Settings → Service accounts
   - Click **"Generate new private key"**
   - Save the JSON file as `firebase-credentials.json`
   - **Keep this secret!** It's like your password

### Step 4: Enable Cloud Messaging

1. In Firebase console → Click **"Cloud Messaging"** in left menu
2. Click **"Get started"**
3. You're done! No additional configuration needed

### Step 5: Upload APNs Key to Firebase

1. In Firebase console → Project Settings → Cloud Messaging
2. Scroll to **"Apple app configuration"**
3. Click **"Upload"** under APNs Authentication Key
4. Upload your **AuthKey_X2X7S84MLF.p8** file
5. Fill in:
   - **Key ID:** X2X7S84MLF
   - **Team ID:** SP6N8UL583
6. Click **"Upload"**

**Done!** Firebase will now handle APNs for you.

---

## Part 2: Backend Setup (10 minutes)

### Step 1: Install Firebase Admin SDK

On your **PythonAnywhere terminal:**

```bash
cd ~/workspace
pip3.10 install --user firebase-admin
```

### Step 2: Upload Credentials to Server

Upload your Firebase credentials JSON to:
```
/home/puntz08/secrets/cpoint-127c2-firebase-adminsdk-fbsvc-1f900dabeb.json
```

**Set permissions:**
```bash
chmod 600 /home/puntz08/secrets/cpoint-127c2-firebase-adminsdk-fbsvc-1f900dabeb.json
```

### Step 3: Update WSGI File

Add to your WSGI file (before importing app):

```python
# Firebase credentials path
os.environ['FIREBASE_CREDENTIALS'] = '/home/puntz08/secrets/cpoint-127c2-firebase-adminsdk-fbsvc-1f900dabeb.json'
```

### Step 4: Backend Code Ready

I'll create the updated backend code for you (next step).

---

## Part 3: iOS App Setup (15 minutes)

### Step 1: Install Firebase SDK

Open terminal in your project:

```bash
cd ~/workspace/client/ios/App
```

Edit `Podfile`, add:
```ruby
pod 'Firebase/Messaging'
```

Install:
```bash
pod install
```

### Step 2: Add GoogleService-Info.plist

1. Open Xcode: `open App.xcworkspace`
2. Drag `GoogleService-Info.plist` into the project (App folder)
3. Make sure **"Copy items if needed"** is checked
4. Target: **App**

### Step 3: Update AppDelegate.swift

Replace the contents of `client/ios/App/App/AppDelegate.swift`:

```swift
import UIKit
import Capacitor
import Firebase
import FirebaseMessaging

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        
        // Initialize Firebase
        FirebaseApp.configure()
        
        // Set FCM delegate
        Messaging.messaging().delegate = self
        
        // Register for push notifications
        UNUserNotificationCenter.current().delegate = self
        
        let authOptions: UNAuthorizationOptions = [.alert, .badge, .sound]
        UNUserNotificationCenter.current().requestAuthorization(
            options: authOptions,
            completionHandler: { _, _ in }
        )
        
        application.registerForRemoteNotifications()
        
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        // Pass device token to Firebase
        Messaging.messaging().apnsToken = deviceToken
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        print("Failed to register for remote notifications: \(error)")
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }
}

// MARK: - UNUserNotificationCenterDelegate
extension AppDelegate: UNUserNotificationCenterDelegate {
    // Handle notifications when app is in foreground
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([[.banner, .sound, .badge]])
    }
    
    // Handle notification tap
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        completionHandler()
    }
}

// MARK: - MessagingDelegate
extension AppDelegate: MessagingDelegate {
    // This is called when FCM token is generated or refreshed
    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        print("Firebase registration token: \(fcmToken ?? "none")")
        
        // Send token to your server
        if let token = fcmToken {
            NotificationCenter.default.post(
                name: Notification.Name("FCMTokenRefresh"),
                object: nil,
                userInfo: ["token": token]
            )
        }
    }
}
```

### Step 4: Create Capacitor Plugin for FCM

Create `client/src/services/fcmNotifications.ts`:

```typescript
import { registerPlugin } from '@capacitor/core';
import { Capacitor } from '@capacitor/core';

export const FCMNotifications = {
  async getToken(): Promise<string | null> {
    if (!Capacitor.isNativePlatform()) {
      return null;
    }
    
    // Listen for FCM token
    return new Promise((resolve) => {
      const listener = (event: any) => {
        if (event && event.token) {
          resolve(event.token);
          window.removeEventListener('FCMTokenRefresh', listener);
        }
      };
      
      window.addEventListener('FCMTokenRefresh', listener);
      
      // Timeout after 5 seconds
      setTimeout(() => {
        resolve(null);
        window.removeEventListener('FCMTokenRefresh', listener);
      }, 5000);
    });
  }
};
```

### Step 5: Update NativePushInit Component

Edit `client/src/components/NativePushInit.tsx`:

```typescript
import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { FCMNotifications } from '../services/fcmNotifications';

export default function NativePushInit() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    const registerFCM = async () => {
      try {
        // Get FCM token
        const token = await FCMNotifications.getToken();
        
        if (token) {
          console.log('FCM Token:', token);
          
          // Register token with your server
          const response = await fetch('/api/push/register_fcm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              token: token,
              platform: 'ios'
            })
          });
          
          if (response.ok) {
            console.log('✅ FCM token registered with server');
          }
        }
      } catch (error) {
        console.error('FCM registration error:', error);
      }
    };

    registerFCM();
  }, []);

  return null;
}
```

---

## Part 4: Testing (5 minutes)

### Step 1: Build and Deploy iOS App

```bash
cd ~/workspace/client
npm run build
npx cap sync ios
```

Open Xcode and build to TestFlight.

### Step 2: Test on Device

1. Open app on iPhone
2. Check Xcode console for: "Firebase registration token: ..."
3. Copy the token
4. Send test notification from Firebase console

### Step 3: Test from Server

In your PythonAnywhere terminal:

```bash
python3.10 test_firebase_notification.py Paulo
```

---

## 🎯 Next Steps

After I create the backend code:

1. **Deploy backend** (pull from main, install firebase-admin)
2. **Build iOS app** (add Firebase, rebuild)
3. **Test** (should work immediately!)

---

## ✅ Benefits You'll Get

- ✅ **No more cryptography errors**
- ✅ **Automatic token refresh**
- ✅ **Built-in retry logic**
- ✅ **Analytics dashboard**
- ✅ **Android ready** (when you need it)
- ✅ **Free tier: 10M messages/month**

---

**Ready to proceed?** Let me create the backend code next! 🚀
