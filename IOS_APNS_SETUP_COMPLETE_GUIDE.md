# 📱 iOS Push Notifications - Complete APNs Setup Guide

## Overview

Your iOS app is **requesting push notification permissions** correctly, but actual notifications aren't being sent because **APNs (Apple Push Notification Service) isn't configured yet**.

---

## ✅ What's Already Done:

1. ✅ iOS app requests notification permissions
2. ✅ Device token is registered with backend
3. ✅ Token is stored in database (`push_tokens` table)
4. ✅ Backend code calls `send_native_push()` when notifications are created
5. ✅ All infrastructure is in place

## ❌ What's Missing:

You need to configure **APNs credentials** from Apple Developer account.

---

## 🔐 Step 1: Get APNs Authentication Key from Apple

### 1.1 Login to Apple Developer Account

Go to: https://developer.apple.com/account/resources/authkeys/list

### 1.2 Create APNs Key

1. Click **"+"** to create a new key
2. **Key Name**: "C.Point APNs Key"
3. **Enable**: Check **"Apple Push Notifications service (APNs)"**
4. Click **Continue** → **Register**
5. **Download the .p8 file** immediately (you can only download it once!)

### 1.3 Note These Values:

After creating the key, you'll see:
- **Key ID**: e.g., `ABC123XYZ`
- **Team ID**: Found in top right of developer portal, e.g., `DEF456UVW`
- **Bundle ID**: `co.cpoint.app` (your app's bundle ID from Xcode)

**Save these values - you'll need them!**

---

## 📦 Step 2: Install APNs Library on Cloud Run

In Cloud Run **Bash console**:

```bash
pip install apns2==0.7.2 --user
```

---

## 🔧 Step 3: Upload APNs Key to Cloud Run

### 3.1 Upload the .p8 File

1. Go to Cloud Run **Files** tab
2. Navigate to `/home/puntz08/WorkoutX/Links/`
3. Create a new directory: `certs`
4. Upload your `.p8` file to `/home/puntz08/WorkoutX/Links/certs/`
5. Rename it to something simple like `apns_key.p8`

### 3.2 Set Permissions

In Bash console:
```bash
cd ~/WorkoutX/Links/certs
chmod 600 apns_key.p8
```

---

## 🌐 Step 4: Configure APNs in WSGI File

Edit your WSGI file: `Cloud Run service configuration`

Add these environment variables:

```python
# APNs Configuration (add after Redis config)
os.environ['APNS_KEY_PATH'] = '/home/puntz08/WorkoutX/Links/certs/apns_key.p8'
os.environ['APNS_KEY_ID'] = 'ABC123XYZ'  # Your Key ID from Apple
os.environ['APNS_TEAM_ID'] = 'DEF456UVW'  # Your Team ID from Apple
os.environ['APNS_BUNDLE_ID'] = 'co.cpoint.app'
os.environ['APNS_USE_SANDBOX'] = 'false'  # Use 'true' for TestFlight/development builds
```

---

## 💻 Step 5: Enable APNs in Backend

Uncomment the APNs code in `backend/services/notifications.py`:

The code is already there, just commented out. I'll create an uncommented version for you.

---

## 🧪 Step 6: Create push_tokens Table

On Cloud Run:

```bash
cd ~/WorkoutX/Links
git pull origin main
python3 add_push_tokens_table.py
```

Expected output:
```
✅ push_tokens table created successfully!
```

---

## 🔄 Step 7: Reload Web App

Go to Cloud Run **Web tab** → Click **Reload**

---

## ✅ Step 8: Test Notifications

### 8.1 Register Device Token

1. Open your iOS app
2. Allow notifications when prompted
3. Check error logs - you should see:
   ```
   📱 Registered new push token for Paulo on ios
   ✅ Push token saved
   ```

### 8.2 Trigger a Notification

Send yourself a message or create a post in a community you're a member of.

### 8.3 Check Logs

You should see:
```
📱 [APNs] Sending to iOS device: [token]...
✅ APNs notification sent successfully
```

---

## 🎯 Production vs Development

### Development/TestFlight Builds:
```python
os.environ['APNS_USE_SANDBOX'] = 'true'
```

Uses Apple's sandbox APNs server for testing.

### App Store Builds:
```python
os.environ['APNS_USE_SANDBOX'] = 'false'
```

Uses Apple's production APNs server.

---

## 🚨 Troubleshooting

### "No push tokens for user"
- App hasn't registered yet
- User denied notifications
- Check `push_tokens` table: `SELECT * FROM push_tokens;`

### "APNs credentials not configured"
- Environment variables not set in WSGI
- .p8 file path is wrong
- Reload web app after adding env vars

### "Invalid credentials" error
- Key ID or Team ID is wrong
- .p8 file is corrupted
- Check values match Apple Developer portal exactly

### Notifications not arriving:
- Using wrong environment (sandbox vs production)
- App was built for production but WSGI has sandbox=true (or vice versa)
- Device token expired (user reinstalled app)

---

## 📊 Verify Setup

### Check Database:

```sql
SELECT * FROM push_tokens WHERE username = 'Paulo';
```

Should show:
```
| id | username | token       | platform | is_active |
|----|----------|-------------|----------|-----------|
| 1  | Paulo    | abc123...   | ios      | 1         |
```

### Check Logs:

After sending a notification, you should see:
```
✅ Push token saved for Paulo
📱 [APNs] Sending notification...
✅ APNs notification sent successfully
```

---

## 🎉 When It's Working:

You'll receive push notifications on your iPhone for:
- ✅ New messages
- ✅ Post replies
- ✅ Community announcements
- ✅ Event reminders
- ✅ Poll notifications

Even when the app is closed or in background! 🚀

---

## 📋 Quick Checklist:

Before asking for help, verify:

- [ ] Downloaded .p8 key from Apple Developer
- [ ] Uploaded .p8 to `/home/puntz08/WorkoutX/Links/certs/`
- [ ] Set all 5 APNs environment variables in WSGI
- [ ] Installed `apns2` library: `pip install apns2==0.7.2 --user`
- [ ] Created `push_tokens` table
- [ ] Reloaded web app
- [ ] App shows token registered in logs
- [ ] Uncommented APNs code in notifications.py

---

## 🔒 Security Notes:

1. **Never commit .p8 file to Git** ✅
2. Keep it in `/certs/` directory (add to .gitignore)
3. Set file permissions to 600 (owner read/write only)
4. Rotate keys periodically (Apple allows this)

---

## 💡 Alternative: Use a Push Service

If APNs setup is too complex, consider:
- **OneSignal** - Free tier, handles APNs/FCM for you
- **Firebase Cloud Messaging** - Google's push service
- **Pusher Beams** - Push notification API

These services handle the APNs complexity and provide a simple API.

---

## 📚 Resources:

- Apple APNs Documentation: https://developer.apple.com/documentation/usernotifications
- pyapns2 Library: https://github.com/Pr0Ger/PyAPNs2
- Testing APNs: Use Apple's Push Notification Console

---

Your iOS app infrastructure is ready - you just need the APNs credentials from Apple! 🍎
