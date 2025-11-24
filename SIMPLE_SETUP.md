# 🚀 Simple Firebase Setup (3 Steps!)

## ✅ All Code Is Ready - Just Pull It!

---

## 📋 Your 3 Steps

### **Step 1: Get Firebase Files (10 min)**

1. Go to https://console.firebase.google.com
2. Create project "C-Point"
3. Add iOS app: bundle ID = `co.cpoint.app`
4. **Download these 2 files:**
   - `GoogleService-Info.plist` (for iOS)
   - `firebase-credentials.json` (for server)
5. Upload `.p8` APNs key to Firebase

---

### **Step 2: Pull Code & Setup (5 min)**

**On your Mac:**
```bash
cd ~/your/project/Links
git pull origin main

# Install Firebase pod
cd client/ios/App
pod install

# Open Xcode
open App.xcworkspace
```

**In Xcode:**
- Drag `GoogleService-Info.plist` into App folder
- That's it! All code is already there ✅

---

### **Step 3: Server Setup (5 min)**

**On PythonAnywhere:**
```bash
cd ~/workspace
git pull origin main

# Install Firebase
pip3.10 install --user firebase-admin

# Upload firebase-credentials.json to:
# /home/puntz08/secrets/firebase-credentials.json

# Create table
python3.10 add_fcm_tokens_table.py

# Add to WSGI file:
# os.environ['FIREBASE_CREDENTIALS'] = '/home/puntz08/secrets/firebase-credentials.json'

# Reload web app
```

---

## ✅ What's Already Done For You

- ✅ All TypeScript code updated
- ✅ Podfile has Firebase
- ✅ AppDelegate.swift configured
- ✅ NativePushInit uses FCM
- ✅ Backend has Firebase service
- ✅ API endpoint ready

**You just need to:**
1. Get Firebase files
2. `git pull` and `pod install`
3. Add GoogleService-Info.plist to Xcode
4. Build!

---

## 🎯 That's It!

No complex steps. Just pull, add one file, build.

**Total time: 20 minutes** ⏱️
