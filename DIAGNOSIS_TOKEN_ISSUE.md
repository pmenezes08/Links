# 🔍 Token Registration Issue - Diagnosis

## Problem Found

The iOS app is **NOT** sending FCM tokens to the server.

---

## 🔍 What I Discovered

### **1. Server Endpoint Works**
```bash
curl -X POST https://www.c-point.co/api/push/register_fcm
Response: {"error":"unauthenticated","success":false}
```
✅ Endpoint exists and responds (just needs auth/session)

### **2. No Tokens in Database**
```bash
SELECT COUNT(*) FROM fcm_tokens
Result: 0
```
❌ ZERO tokens = iOS app never called the endpoint

### **3. The Flow is Broken**

**Current Code Flow:**
1. `AppDelegate.swift` receives FCM token from Firebase ✅
2. Posts to `NotificationCenter` (Swift native) ✅  
3. `fcmNotifications.ts` listens for `FCMTokenRefresh` event ❌
4. **PROBLEM:** Swift NotificationCenter ≠ JavaScript window events!

**The Issue:**
```swift
// In AppDelegate.swift (Line 89-94)
NotificationCenter.default.post(
    name: Notification.Name("FCMTokenRefresh"),
    object: nil,
    userInfo: ["token": token]
)
```

This fires a **Swift notification**, not a **JavaScript event**!

```typescript
// In fcmNotifications.ts (Line 16)
window.addEventListener('FCMTokenRefresh', listener);
```

This listens for **JavaScript events**, not Swift notifications!

**They never connect!**

---

## ✅ Solutions

### **Option 1: Use Capacitor Preferences (Simplest)** ⭐

Instead of events, use Capacitor's built-in storage:

**AppDelegate.swift:**
```swift
func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
    print("🔥 Firebase token: \(fcmToken ?? "none")")
    
    if let token = fcmToken {
        // Save to Capacitor Preferences
        UserDefaults.standard.set(token, forKey: "fcm_token")
    }
}
```

**TypeScript:**
```typescript
import { Preferences } from '@capacitor/preferences';

export const FCMNotifications = {
  async getToken(): Promise<string | null> {
    if (!Capacitor.isNativePlatform()) {
      return null;
    }
    
    // Poll for token (iOS saves it to UserDefaults)
    for (let i = 0; i < 10; i++) {
      const { value } = await Preferences.get({ key: 'fcm_token' });
      if (value) {
        return value;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    return null;
  }
};
```

---

### **Option 2: Create Capacitor Plugin (More Complex)**

Create a custom Capacitor plugin to bridge Swift → JavaScript.

---

### **Option 3: Use Capacitor's Push Notifications Plugin** ⭐⭐

**Simplest and most reliable!**

Already installed: `@capacitor/push-notifications@^6.0.4`

**Replace Firebase/Messaging with Capacitor's plugin:**

**AppDelegate.swift (simplified):**
```swift
import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        return true
    }
    
    // Rest handled by Capacitor automatically
}
```

**TypeScript:**
```typescript
import { PushNotifications } from '@capacitor/push-notifications';

export default function NativePushInit() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    const registerPush = async () => {
      // Request permission
      const permission = await PushNotifications.requestPermissions();
      if (permission.receive !== 'granted') return;

      // Listen for token
      await PushNotifications.addListener('registration', async (token) => {
        console.log('🔥 FCM Token:', token.value);
        
        // Send to server
        await fetch('/api/push/register_fcm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            token: token.value,
            platform: 'ios'
          })
        });
      });

      // Register
      await PushNotifications.register();
    };

    registerPush();
  }, []);

  return null;
}
```

**This works because:**
- Capacitor plugin properly bridges iOS → JavaScript
- Uses Firebase under the hood
- Already installed in your project
- Battle-tested and reliable

---

## 🎯 Recommendation

**Use Option 3 (Capacitor Push Notifications Plugin)**

**Why:**
1. ✅ Already installed (`@capacitor/push-notifications`)
2. ✅ Properly bridges iOS → JavaScript
3. ✅ Works with Firebase automatically
4. ✅ Most reliable and documented
5. ✅ Minimal code changes

---

## 📋 What Needs to Change

1. **AppDelegate.swift** - Simplify (remove Firebase/Messaging code)
2. **NativePushInit.tsx** - Use Capacitor's PushNotifications
3. **fcmNotifications.ts** - Delete (not needed)
4. **Podfile** - Remove Firebase/Messaging, Capacitor handles it

---

## ⚡ Quick Fix Path

The FASTEST fix is Option 1 (Preferences), but Option 3 is the RIGHT fix for long-term.

Let me know which you want and I'll implement it!
