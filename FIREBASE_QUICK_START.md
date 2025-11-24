# 🔥 Firebase Push Notifications - Quick Start

## ✅ What's Ready

All code is pushed to main! Here's your migration plan:

---

## 📋 Step-by-Step Checklist

### **Phase 1: Firebase Console (10 min)**

- [ ] Go to https://console.firebase.google.com
- [ ] Create project "C-Point"
- [ ] Add iOS app with bundle ID: `co.cpoint.app`
- [ ] Download `GoogleService-Info.plist`
- [ ] Download server credentials JSON (Project Settings → Service accounts → Generate new private key)
- [ ] Upload your `.p8` APNs key to Firebase (Cloud Messaging → APNs Authentication Key)

**Files you'll have:**
- `GoogleService-Info.plist` (for iOS app)
- `firebase-credentials.json` (for server)

---

### **Phase 2: Server Setup (5 min)**

```bash
# 1. SSH to PythonAnywhere
ssh puntz08@ssh.pythonanywhere.com
cd ~/workspace

# 2. Pull latest code
git pull origin main

# 3. Install Firebase Admin SDK
pip3.10 install --user firebase-admin

# 4. Upload Firebase credentials JSON
# Upload to: /home/puntz08/secrets/cpoint-127c2-firebase-adminsdk-fbsvc-1f900dabeb.json
chmod 600 /home/puntz08/secrets/cpoint-127c2-firebase-adminsdk-fbsvc-1f900dabeb.json

# 5. Create FCM tokens table
python3.10 add_fcm_tokens_table.py

# 6. Update WSGI file - add this line after other os.environ:
# os.environ['FIREBASE_CREDENTIALS'] = '/home/puntz08/secrets/cpoint-127c2-firebase-adminsdk-fbsvc-1f900dabeb.json'

# 7. Reload web app
```

---

### **Phase 3: iOS App Setup (15 min)**

```bash
cd ~/workspace/client/ios/App

# 1. Edit Podfile, add:
# pod 'Firebase/Messaging'

# 2. Install
pod install

# 3. Open Xcode
open App.xcworkspace

# 4. Drag GoogleService-Info.plist into project (App folder)

# 5. Update AppDelegate.swift
# (See FIREBASE_MIGRATION_GUIDE.md for full code)

# 6. Update NativePushInit component
# (See FIREBASE_MIGRATION_GUIDE.md for TypeScript code)

# 7. Build and upload to TestFlight
cd ~/workspace/client
npm run build
npx cap sync ios
# Then open Xcode and archive
```

---

### **Phase 4: Test (5 min)**

```bash
# After installing TestFlight app on iPhone:

# 1. On server, test notification
python3.10 test_firebase_notification.py Paulo

# 2. Check iPhone - should receive notification!
```

---

## 🎯 What You Get

✅ **No more errors:**
- No "curve must be an EllipticCurve instance"
- No cryptography version conflicts
- No PyJWT/httpx issues

✅ **Better reliability:**
- Google manages all APNs complexity
- Automatic token refresh
- Built-in retry logic

✅ **Future-ready:**
- Android support (when needed)
- Analytics dashboard
- A/B testing capability

✅ **Free tier:**
- 10 million messages per month
- More than enough for your app

---

## 📚 Full Documentation

- **FIREBASE_MIGRATION_GUIDE.md** - Complete step-by-step guide
- **backend/services/firebase_notifications.py** - Server code
- **test_firebase_notification.py** - Test script

---

## 🚀 Time Estimate

- Firebase Console: 10 min
- Server setup: 5 min
- iOS app changes: 15 min
- Testing: 5 min

**Total: 35 minutes to working push notifications!**

---

## ❓ Questions?

The complete guide in **FIREBASE_MIGRATION_GUIDE.md** has:
- Detailed instructions for each step
- Full code examples
- Troubleshooting tips
- AppDelegate.swift complete code
- NativePushInit.tsx complete code

---

**Ready to start? Begin with Phase 1 (Firebase Console)!** 🔥
