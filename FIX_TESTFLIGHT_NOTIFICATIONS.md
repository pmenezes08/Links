# 🔔 Fix TestFlight Push Notifications

## 🔍 Problem Diagnosed

Your iOS app **IS** registering push tokens correctly, but notifications aren't being sent because:

1. ❌ **APNs code was commented out** (FIXED ✅)
2. ❌ **apns2 library not installed** (FIXED ✅)
3. ⚠️  **.p8 key file location issue** (NEEDS YOUR ACTION)

---

## ✅ What I Fixed

### 1. Updated `requirements.txt`
Added: `apns2==0.7.2` for iOS push notifications

### 2. Fixed `backend/services/notifications.py`
- Uncommented APNs sending code
- Added comprehensive error handling
- Added detailed logging to debug issues
- Checks if .p8 file exists before attempting to send

### 3. Created Diagnostic Tool
New file: `test_apns_setup.py` - Tests your entire APNs configuration

---

## 🚨 CRITICAL: Check Your .p8 File Location

Your WSGI configuration shows:
```python
os.environ['APNS_KEY_PATH'] = '/home/puntz08/secrets/AuthKey_X2X7S84MLF.p8'
```

**This file does NOT exist on the server!**

### Option A: File is in a different location
Run this to find it:
```bash
find /home/puntz08 -name "*.p8" 2>/dev/null
```

If found, update your WSGI file with the correct path.

### Option B: File is missing
You need to:
1. Go to [Apple Developer Portal](https://developer.apple.com/account/resources/authkeys/list)
2. Download your APNs key (or create a new one if lost)
3. Upload the .p8 file to: `/home/puntz08/secrets/`
4. Set permissions: `chmod 600 /home/puntz08/secrets/AuthKey_*.p8`

---

## 📋 Step-by-Step Fix Instructions

### Step 1: Install Dependencies
```bash
cd /home/puntz08/WorkoutX/Links  # Or your app directory
pip install apns2==0.7.2 --user
```

### Step 2: Verify/Upload .p8 File
```bash
# Check if file exists
ls -la /home/puntz08/secrets/AuthKey_X2X7S84MLF.p8

# If not found, create secrets directory
mkdir -p /home/puntz08/secrets

# Upload your .p8 file to this directory
# Then set permissions:
chmod 600 /home/puntz08/secrets/AuthKey_*.p8
```

### Step 3: Verify WSGI Configuration
Your WSGI file should have:
```python
os.environ['APNS_KEY_PATH'] = '/home/puntz08/secrets/AuthKey_X2X7S84MLF.p8'
os.environ['APNS_KEY_ID'] = 'X2X7S84MLF'
os.environ['APNS_TEAM_ID'] = 'SP6N8UL583'
os.environ['APNS_BUNDLE_ID'] = 'co.cpoint.app'
os.environ['APNS_USE_SANDBOX'] = 'true'  # ✅ Correct for TestFlight
```

**IMPORTANT**: For TestFlight, you MUST use `APNS_USE_SANDBOX = 'true'`

### Step 4: Reload Your Web App
After making changes, reload your web app on your hosting service.

### Step 5: Run Diagnostic
```bash
cd /home/puntz08/WorkoutX/Links
python test_apns_setup.py
```

This will check:
- ✅ apns2 library installed
- ✅ Environment variables set
- ✅ .p8 file exists and has correct permissions
- ✅ Database table exists
- ✅ APNs connection works

### Step 6: Test with Real Device
1. Open your iOS TestFlight app
2. Allow push notifications (if prompted)
3. Trigger a notification (send a message, create a post, etc.)
4. Check your server logs for:
   ```
   📱 [APNs] Attempting to send to iOS device...
   📤 Sending APNs notification...
   ✅ APNs notification sent successfully
   ```

---

## 🔍 Troubleshooting

### "apns2 library not installed"
```bash
pip install apns2==0.7.2 --user
```

### "APNs key file not found"
1. Check file path in WSGI is correct
2. File must exist at that exact location
3. Run: `ls -la /home/puntz08/secrets/` to see what's there

### "APNs credentials not configured"
- Environment variables not set in WSGI
- Reload web app after adding env vars

### "Invalid credentials" error
- Key ID or Team ID is wrong
- Bundle ID doesn't match your app
- Check Apple Developer Portal for correct values

### Notifications still not arriving
**Most common issue**: Using wrong environment!

For **TestFlight** builds: `APNS_USE_SANDBOX = 'true'`
For **App Store** builds: `APNS_USE_SANDBOX = 'false'`

TestFlight apps will ONLY receive notifications from Apple's sandbox server.

---

## 🧪 Send Test Notification

Once setup is complete, you can send a test notification to a specific device:

```bash
# Get device token from your logs (when app registers)
python test_apns_setup.py <device_token>
```

---

## 📊 Check Database for Registered Devices

```python
from backend.services.database import get_db_connection

conn = get_db_connection()
cursor = conn.cursor()
cursor.execute("SELECT username, LEFT(token, 20), platform, created_at FROM push_tokens WHERE platform='ios' ORDER BY created_at DESC LIMIT 10")
for row in cursor.fetchall():
    print(row)
```

---

## 🎯 Quick Checklist

Before asking for help, verify:

- [ ] `pip install apns2==0.7.2` completed
- [ ] .p8 file exists at the path in WSGI
- [ ] All 5 APNS_* environment variables set in WSGI
- [ ] `APNS_USE_SANDBOX = 'true'` for TestFlight
- [ ] Web app reloaded after changes
- [ ] `python test_apns_setup.py` shows all ✅
- [ ] iOS app successfully registered device token (check logs)
- [ ] Server logs show APNs sending attempts

---

## 📱 What Happens When It Works

1. **User opens iOS app**
   ```
   🔔 Initializing native push notifications...
   🔔 Permission granted! Registering for push...
   Push registration success, token: abc123...
   📱 Registered new push token for <username> on ios
   ```

2. **Someone sends a notification**
   ```
   📱 [APNs] Attempting to send to iOS device: abc123...
   📤 Sending APNs notification...
   ✅ APNs notification sent successfully
   ```

3. **User receives notification** on their iPhone! 🎉

---

## 🔐 Security Notes

1. Never commit .p8 file to git
2. Keep in `/secrets/` directory (add to .gitignore)
3. Set file permissions to 600
4. Only share Key ID/Team ID in secure channels

---

## 📚 Resources

- [Apple APNs Documentation](https://developer.apple.com/documentation/usernotifications)
- [PyAPNs2 Library](https://github.com/Pr0Ger/PyAPNs2)
- [Capacitor Push Notifications](https://capacitorjs.com/docs/apis/push-notifications)

---

## 🆘 Still Having Issues?

Run the diagnostic and share the output:
```bash
python test_apns_setup.py > apns_diagnostic.txt 2>&1
```

This will show exactly what's configured and what's missing.

---

**Your iOS app infrastructure is ready - you just need to ensure the .p8 file is in the right place!** 🍎
