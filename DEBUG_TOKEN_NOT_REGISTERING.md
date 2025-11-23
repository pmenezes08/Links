# 🐛 Debug: Token Not Registering

## Issue
iOS app is not sending/storing push token to database.

---

## 🔍 Diagnostic Steps

### Step 1: Check if Web App Was Reloaded
**Did you reload your web app after the code changes?**

The anonymous token registration code needs to be active on the server.

✅ **Action:** Reload your web application

---

### Step 2: Check Server Logs
Look for ANY activity when you open the TestFlight app:

**Good signs (token being sent):**
```
POST /api/push/register_native
📱 Storing anonymous push token (will associate with user on login)
✅ Push token saved
```

**Bad signs (nothing in logs):**
- No log entries at all = App isn't sending the token
- Error messages = Backend issue

**How to check logs:**
- Check your web server error log
- Look for timestamps matching when you opened the app

---

### Step 3: Check iOS App Console Logs
Connect your iPhone to a Mac and check Xcode console:

1. Connect iPhone via USB
2. Open Xcode
3. Window → Devices and Simulators
4. Select your iPhone
5. Click "Open Console" button
6. Filter by "Push" or "notification"

**Look for:**
```
🔔 Initializing native push notifications...
🔔 Permission granted! Registering for push...
Push registration success, token: abc123def456...
```

**Or errors like:**
```
🔔 ❌ Push notification permission not granted
Push registration error: ...
```

---

### Step 4: Verify Notification Permission
Check iPhone Settings:

1. Settings → C-Point app
2. Tap "Notifications"
3. Is "Allow Notifications" **ON**?

If OFF, the app won't generate a token.

---

### Step 5: Check if push_tokens Table Exists
```bash
export MYSQL_PASSWORD='YourPassword'
mysql -u puntz08 -p"$MYSQL_PASSWORD" -h puntz08.mysql.pythonanywhere-services.com "puntz08\$C-Point" -e "
SHOW TABLES LIKE 'push_tokens';
DESCRIBE push_tokens;
"
```

If table doesn't exist:
```bash
python add_push_tokens_table.py
```

---

## 🧪 Manual Test: Check if Endpoint Works

Test the registration endpoint directly:

```bash
# Test while logged in
curl -X POST https://your-domain.com/api/push/register_native \
  -H "Content-Type: application/json" \
  -H "Cookie: session=YOUR_SESSION_COOKIE" \
  -d '{"token": "test_token_123", "platform": "ios"}' \
  -v
```

Should return:
```json
{"success": true, "message": "Push token registered successfully"}
```

---

## 🎯 Most Likely Issues

### Issue 1: Web App Not Reloaded ⚠️ MOST COMMON
**Symptom:** No server logs when opening app
**Fix:** Reload your web application

### Issue 2: iOS App Not Requesting Permission
**Symptom:** No token in iOS console logs
**Fix:** 
- Check Settings → C-Point → Notifications (turn on if off)
- Force quit and reopen app

### Issue 3: Network Error
**Symptom:** iOS shows token but backend logs show error
**Fix:** Check server error logs for details

### Issue 4: Session/CORS Issue
**Symptom:** Backend logs show 401 or CORS error
**Fix:** The anonymous registration should handle this now

---

## 📊 Quick Diagnostic Commands

### Check if ANY tokens exist:
```bash
export MYSQL_PASSWORD='YourPassword'
mysql -u puntz08 -p"$MYSQL_PASSWORD" -h puntz08.mysql.pythonanywhere-services.com "puntz08\$C-Point" -e "
SELECT * FROM push_tokens;
"
```

### Check for anonymous tokens:
```bash
export MYSQL_PASSWORD='YourPassword'
mysql -u puntz08 -p"$MYSQL_PASSWORD" -h puntz08.mysql.pythonanywhere-services.com "puntz08\$C-Point" -e "
SELECT * FROM push_tokens WHERE username LIKE 'anonymous_%';
"
```

### Check recent token activity:
```bash
export MYSQL_PASSWORD='YourPassword'
mysql -u puntz08 -p"$MYSQL_PASSWORD" -h puntz08.mysql.pythonanywhere-services.com "puntz08\$C-Point" -e "
SELECT username, platform, created_at, updated_at 
FROM push_tokens 
ORDER BY created_at DESC 
LIMIT 10;
"
```

---

## 🔧 Action Plan

1. **✅ Reload web app** (if not done yet)
2. **✅ Check server logs** when opening TestFlight app
3. **✅ Check iOS console logs** (if you have Xcode)
4. **✅ Verify notification permission** in iPhone Settings
5. **✅ Check database** for any tokens

---

## 🆘 What to Share for Debugging

If still not working, share:

1. **Server logs** (last 20 lines when opening app)
2. **iOS console logs** (filter by "Push")
3. **Notification permission status** (Settings → C-Point → Notifications)
4. **Database query results** (SELECT * FROM push_tokens)
5. **Did you reload the web app?** (Yes/No)

---

## 💡 Temporary Workaround

If you can get the device token from iOS console logs, you can manually insert it:

```bash
# Get token from Xcode console, then:
export MYSQL_PASSWORD='YourPassword'
mysql -u puntz08 -p"$MYSQL_PASSWORD" -h puntz08.mysql.pythonanywhere-services.com "puntz08\$C-Point" <<EOF
INSERT INTO push_tokens (username, token, platform, is_active) 
VALUES ('Paulo', 'YOUR_DEVICE_TOKEN_HERE', 'ios', 1);
EOF

# Then test:
python3 test_send_apns.py Paulo
```

This at least lets you test if notifications work while we debug registration.
