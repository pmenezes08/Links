# 🔍 Troubleshooting: Token Still Not Registering

## Most Common Causes

### ❌ **#1: Files Not Actually Added to Xcode Project**

**The Problem**: Just having files in the folder doesn't mean Xcode includes them in the build!

**How to Check**:
1. Open Xcode: `cd client/ios/App && open App.xcworkspace`
2. Look in left sidebar under `App/App/`
3. You should see these files **in blue/white** (not gray):
   - ✅ `AppDelegate.swift`
   - ✅ `FCMPlugin.swift` ← **Must be visible**
   - ✅ `GoogleService-Info.plist` ← **Must be visible**
   - ✅ `Info.plist`

**If FCMPlugin.swift or GoogleService-Info.plist are NOT visible**:
1. In Xcode, right-click `App/App` folder (blue icon)
2. Click "Add Files to App..."
3. Navigate to the file
4. **CRITICAL**: Check both boxes:
   - ✅ "Copy items if needed"
   - ✅ "Add to targets: App"
5. Click "Add"

**If files are gray/dimmed in Xcode**:
- Right-click the file → Show File Inspector (right sidebar)
- Under "Target Membership", check ✅ App

---

### ❌ **#2: GoogleService-Info.plist is Wrong or Invalid**

**The Problem**: Downloaded wrong file or from wrong Firebase project.

**How to Check**:
```bash
cd ~/your/Links/project
cat client/ios/App/App/GoogleService-Info.plist | grep BUNDLE_ID
```

Should show: `co.cpoint.app`

**If wrong or missing**:
1. Go to: https://console.firebase.google.com/
2. Select project: **cpoint-127c2**
3. ⚙️ Project Settings
4. Scroll to "Your apps" → iOS app
5. Find app with Bundle ID: `co.cpoint.app`
6. Download GoogleService-Info.plist
7. Replace the old one in Xcode

---

### ❌ **#3: React Build Not Copied to iOS App**

**The Problem**: Old JavaScript code in iOS app, doesn't have FCM plugin calls.

**How to Check**:
```bash
cd ~/your/Links/project/client
ls -la ios/App/App/public/assets/*.js | head -5
```

Should show files with recent timestamps.

**If old or missing**:
```bash
cd ~/your/Links/project/client
npm run build
rm -rf ios/App/App/public
cp -r dist ios/App/App/public
```

Then rebuild in Xcode.

---

### ❌ **#4: Need to Log In First**

**The Problem**: Token is generated but user isn't logged in yet.

**The endpoint accepts tokens before login**, but let's verify:

**Test Flow**:
1. Open app
2. **Log in as Paulo**
3. Close app completely (swipe up in app switcher)
4. Reopen app
5. Wait 5 seconds
6. Check server for token

---

## 🧪 Debugging Steps

### **Step 1: Run Debug Script on Server**

On PythonAnywhere:
```bash
cd /home/puntz08/WorkoutX/Links
bash debug_token_issue.sh
```

This will check:
- ✅ Files exist
- ✅ Database table exists
- ✅ If tokens were registered (even if not associated with Paulo)
- ✅ Endpoint works

---

### **Step 2: Check Xcode Console** (iPhone connected to Mac)

1. Connect iPhone to Mac with cable
2. Open Xcode
3. Window → Devices and Simulators
4. Select your iPhone
5. Click "Open Console" button (bottom of window)
6. Open the app on iPhone
7. Watch console output

**Look for these messages**:

✅ **Firebase Initialized**:
```
🔥 Firebase token: abc123def456...
```
If you see this: Firebase is working!

✅ **Plugin Working**:
```
✅ FCMPlugin: Returning token: abc123...
```
If you see this: Plugin bridge is working!

✅ **Token Sent**:
```
📤 Registering token with server...
✅ FCM token registered with server
```
If you see this: Full flow works!

---

### **Step 3: Check What's Missing**

| What You See | What It Means | Fix |
|--------------|---------------|-----|
| Nothing | Firebase not initializing | GoogleService-Info.plist not added |
| Firebase token, no plugin message | Plugin not loaded | FCMPlugin.swift not added to Xcode target |
| Plugin message, no "Registering" | JavaScript not calling plugin | Old React build, run npm build again |
| "Registering", but error | Network/endpoint issue | Check server logs |

---

## 🔬 Advanced Debugging

### **Check Safari Web Inspector** (if possible)

1. On Mac: Safari → Preferences → Advanced → ✅ Show Develop menu
2. Connect iPhone via cable
3. On iPhone, open C.Point app
4. On Mac: Safari → Develop → [Your iPhone] → [C.Point]
5. JavaScript console opens

**Look for**:
```javascript
🔥 NativePushInit: Starting FCM registration...
🔥 FCMNotifications: Requesting token...
```

If you see error:
```
❌ Error: FCMPlugin is not implemented
```
→ FCMPlugin.swift not added to Xcode

---

### **Check Server Database Directly**

```bash
python3.10 << 'EOF'
import sys
sys.path.insert(0, '/home/puntz08/WorkoutX/Links')
from backend.services.database import get_db_connection

conn = get_db_connection()
cursor = conn.cursor()

# Check for Paulo's tokens
cursor.execute("SELECT * FROM fcm_tokens WHERE username = 'Paulo'")
rows = cursor.fetchall()
print(f"Tokens for Paulo: {len(rows)}")
for row in rows:
    if isinstance(row, dict):
        print(f"  {row['token'][:30]}... | {row['platform']} | {row['created_at']}")
    else:
        print(f"  {row[0][:30]}... | {row[1]} | {row[2]}")

# Check for NULL username (registered before login)
cursor.execute("SELECT * FROM fcm_tokens WHERE username IS NULL")
rows = cursor.fetchall()
print(f"\nTokens with NULL username: {len(rows)}")
for row in rows:
    if isinstance(row, dict):
        print(f"  {row['token'][:30]}... | {row['platform']} | {row['created_at']}")
    else:
        print(f"  {row[0][:30]}... | {row[1]} | {row[2]}")

cursor.close()
conn.close()
EOF
```

---

### **Test Endpoint Manually**

From PythonAnywhere bash:
```bash
python3.10 << 'EOF'
import requests

url = "https://www.c-point.co/api/push/register_fcm"
data = {
    "token": "test_manual_token_12345",
    "platform": "ios"
}

response = requests.post(url, json=data)
print(f"Status: {response.status_code}")
print(f"Response: {response.json()}")
EOF
```

Should return: `{"success": true, "message": "FCM token registered"}`

---

## 📋 Checklist Before Rebuild

Before archiving again, verify ALL of these:

- [ ] `git pull origin main` done
- [ ] `npm run build` done (in client folder)
- [ ] `cp -r dist ios/App/App/public` done
- [ ] Xcode shows `FCMPlugin.swift` in left sidebar (blue/white, not gray)
- [ ] Xcode shows `GoogleService-Info.plist` in left sidebar
- [ ] GoogleService-Info.plist contains `co.cpoint.app` bundle ID
- [ ] Right-click both files → Target Membership → ✅ App is checked
- [ ] Product → Clean Build Folder
- [ ] Product → Archive

---

## 🎯 Most Likely Issue

Based on similar issues, **90% of the time it's**:

### **FCMPlugin.swift exists in the folder but isn't added to the Xcode project**

**Symptoms**:
- File is in Finder
- `git pull` shows it
- But Xcode doesn't compile it
- JavaScript gets "FCMPlugin not found" error

**Fix**:
1. In Xcode left sidebar, look for `FCMPlugin.swift` under `App/App/`
2. If it's NOT there or is gray:
   - Right-click `App/App` folder
   - "Add Files to App..."
   - Select `FCMPlugin.swift`
   - ✅ Check "Copy items if needed"
   - ✅ Check "Add to targets: App"
   - Click "Add"
3. File should now appear in blue/white
4. Clean and rebuild

---

## 📞 Next Steps

1. Run `bash debug_token_issue.sh` on PythonAnywhere
2. Share the output
3. Check Xcode for the file visibility issue
4. If still stuck, connect iPhone to Mac and share Xcode console output

The debug script will tell us exactly what's missing! 🔍
