# 📱 Build and Upload iOS App to TestFlight

## ✅ Changes Made

1. **Removed PWA Install Prompt** - Deleted `PwaInstallPrompt.tsx` component entirely
2. **Updated Branding** - Changed "Welcome to Community Point" → "Welcome to Connection Point"

---

## 🔨 Build Steps

### 1. Pull Latest Code

```bash
cd /workspace
git pull origin main
```

### 2. Build React App

```bash
cd /workspace/client
npm install  # If needed
npm run build
```

This creates the production build in `client/dist/`

### 3. Sync with Capacitor

```bash
npx cap sync ios
```

This copies the web build to the iOS app and updates native dependencies.

### 4. Open in Xcode

```bash
npx cap open ios
```

This opens the iOS project in Xcode.

---

## 📤 Upload to TestFlight

### In Xcode:

1. **Select Target Device**
   - At the top, select "Any iOS Device (arm64)" or "Generic iOS Device"

2. **Archive the App**
   - Product → Archive
   - Wait for the build to complete (~5-10 minutes)

3. **Distribute to TestFlight**
   - When the Organizer window appears, click "Distribute App"
   - Choose "App Store Connect"
   - Click "Upload"
   - Select your signing certificate
   - Click "Upload"

4. **Wait for Apple Processing**
   - Go to App Store Connect (https://appstoreconnect.apple.com)
   - Select your app
   - Go to TestFlight tab
   - Wait for the build to process (~5-30 minutes)
   - You'll get an email when it's ready

5. **Make Build Available**
   - Once processed, the build will appear in TestFlight
   - It might auto-enable for testers, or you may need to enable it manually

---

## 📱 Test on iPhone

### After TestFlight Build is Available:

1. **Update App on iPhone**
   - Open TestFlight app on iPhone
   - Find C-Point app
   - Tap "Update" if a new build is available
   - Wait for download and install

2. **Test the Changes**
   - Open the app
   - Check welcome page → Should say "Welcome to Connection Point"
   - **Should NOT see PWA install prompt**
   - Accept notification permission when prompted

3. **Check Push Token Registration**
   - Open the app
   - Wait 30 seconds
   - Log in as Paulo
   - Run SQL query:
   
   ```sql
   SELECT 
       username, 
       LEFT(token, 40) as token_preview,
       LENGTH(token) as token_length,
       platform 
   FROM push_tokens 
   WHERE username = 'Paulo';
   ```
   
   - Token length should be **64+ characters** (not 16 like "test_token_works")

---

## 🧪 Test Push Notifications

Once you have a real iOS token (64+ characters):

```bash
cd /workspace
export MYSQL_PASSWORD='5r4VN4Qq'
python3 test_send_apns.py Paulo
```

You should receive a push notification on your iPhone! 📱

---

## 🔍 Verify Real Token

A **real iOS device token** looks like this:
```
abc123def456789012345678901234567890123456789012345678901234  (64 characters)
```

A **test token** looks like this:
```
test_token_works  (16 characters)
```

---

## ⚠️ Troubleshooting

### Build Fails
- Make sure you have the latest Xcode
- Check code signing settings in Xcode
- Verify your Apple Developer account is active

### No New Build in TestFlight
- Check App Store Connect for processing status
- Look for email from Apple about build status
- Check for any compliance issues

### Token Still Not Registering
- Check PythonAnywhere server logs when opening app
- Look for `POST /api/push/register_native` with a long token
- Verify notification permissions are ON in iPhone Settings

---

## 📋 Checklist Before Uploading

- [ ] Code changes pulled from git
- [ ] `npm run build` completed successfully
- [ ] `npx cap sync ios` completed successfully
- [ ] Xcode opened the project
- [ ] Archive created successfully
- [ ] Upload to App Store Connect succeeded
- [ ] Build appears in TestFlight
- [ ] Build installed on test device
- [ ] Welcome page shows "Connection Point" ✅
- [ ] No PWA install prompt appears ✅
- [ ] Push notifications work ✅

---

## 📝 Version Number

Consider incrementing the version number in:
- `client/package.json` (version field)
- Xcode project settings (Build number)

This makes it easier to track which build is which in TestFlight.

---

Good luck! 🚀
