# 🧪 Testing APNs Notifications - Complete Guide

## 📋 Pre-Flight Checklist

Before testing, verify these are complete:

### 1️⃣ Library Installed
```bash
python3 -c "from apns2.client import APNsClient; print('✅ APNs library working')"
```

**Expected:** `✅ APNs library working`

### 2️⃣ .p8 Key File Exists
```bash
ls -la /home/puntz08/secrets/AuthKey_X2X7S84MLF.p8
```

**Expected:** File exists with 600 permissions

### 3️⃣ WSGI Configuration
Your WSGI file should contain:
```python
os.environ['APNS_KEY_PATH'] = '/home/puntz08/secrets/AuthKey_X2X7S84MLF.p8'
os.environ['APNS_KEY_ID'] = 'X2X7S84MLF'
os.environ['APNS_TEAM_ID'] = 'SP6N8UL583'
os.environ['APNS_BUNDLE_ID'] = 'co.cpoint.app'
os.environ['APNS_USE_SANDBOX'] = 'true'  # For TestFlight
```

### 4️⃣ Web App Reloaded
After any changes, reload your web application.

---

## 🎯 Testing Methods

### Method 1: Check Web App Logs (Easiest)

#### Step 1: Open TestFlight App
Open your iOS app on a test device.

#### Step 2: Trigger a Notification
Do any action that creates a notification:
- Send yourself a message
- Have someone reply to your post
- Create a post in a community you're a member of

#### Step 3: Check Server Logs
Look for these log messages:

**✅ Success Indicators:**
```
APNs client initialized (sandbox=True, bundle=co.cpoint.app)
📱 [APNs] Attempting to send to iOS device: abc123...
✅ APNs alert sent to token abc123...
```

**❌ Error Indicators:**
```
apns2 library not available; skipping APNs send
APNs env vars missing; skipping APNs send
APNs key path does not exist: /path/to/key
APNs rejected token abc123: BadDeviceToken
```

---

### Method 2: Database Check - Verify Device Token

Check if your iOS device registered successfully:

```bash
python3 -c "
from backend.services.database import get_db_connection
conn = get_db_connection()
cursor = conn.cursor()
cursor.execute(\"SELECT username, platform, LEFT(token, 20) as token_preview, created_at, is_active FROM push_tokens WHERE platform='ios' ORDER BY created_at DESC LIMIT 5\")
print('Recent iOS Device Registrations:')
print('-' * 80)
for row in cursor.fetchall():
    print(f'{row[0]:<15} {row[1]:<8} {row[2]}... Active:{row[4]} ({row[3]})')
cursor.close()
conn.close()
"
```

**Expected Output:**
```
Recent iOS Device Registrations:
--------------------------------------------------------------------------------
YourUsername    ios      abc123...           Active:1 (2024-01-15 19:30:00)
```

---

### Method 3: Send Test Notification (Direct Test)

Create a test notification sender:

```bash
python3 test_send_apns.py <your_username>
```

This will send a test notification directly. Check if it arrives on your device.

---

### Method 4: Check APNs Client Initialization

Monitor if APNs client initializes when web app starts:

```bash
# Check recent error logs for APNs mentions
grep -i "apns" /path/to/your/error.log | tail -20
```

Look for:
- `✅ APNs client initialized` → Good!
- `❌ APNs key path does not exist` → Fix .p8 file path
- `❌ apns2 library not available` → Library not properly installed

---

## 🧪 Detailed Test Script

I've created `test_send_apns.py` - run it like this:

```bash
# Test with your username
python3 test_send_apns.py Paulo

# Or test with device token directly
python3 test_send_apns.py --token abc123def456...
```

This will:
1. ✅ Check if apns2 is importable
2. ✅ Verify environment variables are set
3. ✅ Check .p8 key file exists
4. ✅ Look up your device token from database
5. ✅ Send a test notification via APNs
6. ✅ Report success or detailed error

---

## 📱 What Should Happen When Working

### On Device Registration (App Opens):
**iOS App Console:**
```
🔔 Initializing native push notifications...
🔔 Permission granted! Registering for push...
Push registration success, token: abc123...
```

**Server Logs:**
```
📱 Registered new push token for Paulo on ios
✅ Push token saved - Platform: ios, Token: abc123...
```

### When Notification Sent:
**Server Logs:**
```
📱 [APNs] Attempting to send to iOS device: abc123...
   Title: New Message
   Body: Hello from C.Point!
   Key Path: /home/puntz08/secrets/AuthKey_X2X7S84MLF.p8
   Key ID: X2X7S84MLF
   Team ID: SP6N8UL583
   Bundle ID: co.cpoint.app
   Use Sandbox: True
📤 Sending APNs notification...
✅ APNs alert sent to token abc123...
```

**iOS Device:**
- 🔔 Notification appears in notification center
- 📱 Banner shows on screen (if app is not in focus)
- 🔊 Sound plays (if enabled)
- Badge count increases (if configured)

---

## 🐛 Common Issues & Fixes

### Issue 1: "apns2 library not available"
**Fix:**
```bash
pip install apns2==0.7.2 --user
# Or the patched version
pip install PyAPNs2 --user
```

### Issue 2: "APNs key path does not exist"
**Fix:**
```bash
# Check file exists
ls -la /home/puntz08/secrets/AuthKey_X2X7S84MLF.p8

# If not, upload from Apple Developer Portal
# Set correct permissions
chmod 600 /home/puntz08/secrets/AuthKey_*.p8
```

### Issue 3: "APNs rejected token: BadDeviceToken"
**Causes:**
- Using wrong environment (sandbox vs production)
- App was reinstalled (token changed)
- Token from different app/bundle ID

**Fix:**
```python
# Check WSGI file has correct setting
os.environ['APNS_USE_SANDBOX'] = 'true'  # For TestFlight
# os.environ['APNS_USE_SANDBOX'] = 'false'  # For App Store
```

### Issue 4: No notifications arriving
**Checklist:**
- [ ] Device has notifications enabled for your app
- [ ] TestFlight app is using sandbox APNs (APNS_USE_SANDBOX='true')
- [ ] App Store app is using production APNs (APNS_USE_SANDBOX='false')
- [ ] Device is connected to internet
- [ ] Token is not expired (check database: is_active=1)

---

## 🎉 Success Criteria

You'll know it's working when:

1. ✅ Server logs show "APNs alert sent to token..."
2. ✅ No errors in error logs
3. ✅ Notification appears on iPhone
4. ✅ Database shows active device token
5. ✅ Can trigger notifications from multiple actions

---

## 📊 Quick Status Check

Run this one-liner to check everything:

```bash
python3 -c "
import os
print('1. apns2:', end=' ')
try:
    from apns2.client import APNsClient
    print('✅')
except: print('❌')

print('2. .p8 file:', end=' ')
print('✅' if os.path.exists('/home/puntz08/secrets/AuthKey_X2X7S84MLF.p8') else '❌')

print('3. Env vars:', end=' ')
# Note: Only available in WSGI context
print('⚠️  Check WSGI file')

from backend.services.database import get_db_connection
conn = get_db_connection()
cursor = conn.cursor()
cursor.execute('SELECT COUNT(*) FROM push_tokens WHERE platform=\"ios\" AND is_active=1')
count = cursor.fetchone()[0]
print(f'4. iOS tokens: {count}', '✅' if count > 0 else '❌')
cursor.close()
conn.close()
"
```

---

## 🆘 Need Help?

If notifications still don't work after testing:

1. Run: `python3 test_send_apns.py <your_username>`
2. Share the complete output
3. Share server error logs (last 50 lines with "apns" in them)
4. Confirm TestFlight app vs App Store app

---

## 📚 Additional Resources

- [Apple APNs Documentation](https://developer.apple.com/documentation/usernotifications)
- [Testing Push Notifications](https://developer.apple.com/documentation/usernotifications/testing_notifications_using_the_push_notification_console)
- [Capacitor Push Notifications](https://capacitorjs.com/docs/apis/push-notifications)

---

**Remember:** For TestFlight, always use `APNS_USE_SANDBOX='true'`. Only switch to `'false'` for App Store builds! 🍎
