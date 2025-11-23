# 🎯 Final Testing Steps for iOS Push Notifications

## ✅ Current Status
- Backend code is deployed and working
- Test token successfully registered
- Endpoint is accepting anonymous registrations

---

## 📱 Step 1: Get iOS Device to Register Token

### On Your iPhone:

1. **Force quit** the TestFlight app completely:
   - Double-click home button (or swipe up from bottom)
   - Swipe up on the C-Point app to close it

2. **Open** the TestFlight app again

3. **Watch for**:
   - Notification permission prompt (if you haven't granted it yet)
   - If prompt appears, tap **"Allow"**
   - If no prompt appears, that's okay - iOS remembers previous decision

4. **Wait 10 seconds** on the app (don't rush to login)
   - The app should automatically register for push notifications
   - Token registration happens in the background

5. **Check iPhone Settings**:
   - Settings → C-Point
   - Tap "Notifications"
   - Verify "Allow Notifications" is **ON**
   - If it's OFF, turn it ON, then force quit and reopen the app

---

## 🔍 Step 2: Check If Token Was Registered

Run this SQL query:

```sql
SELECT * FROM push_tokens 
WHERE username LIKE '%Paulo%' OR username LIKE 'anonymous_%'
ORDER BY created_at DESC;
```

### Expected Results:

**Scenario A: Token registered before login (IDEAL)**
```
| id | username                  | token              | platform | created_at          |
|----|---------------------------|--------------------|----------|---------------------|
| 2  | anonymous_abc123def456... | <long token>       | ios      | 2025-11-23 21:15:00 |
```

**Scenario B: Token registered after login**
```
| id | username | token        | platform | created_at          |
|----|----------|--------------|----------|---------------------|
| 2  | Paulo    | <long token> | ios      | 2025-11-23 21:15:00 |
```

**Scenario C: No new token yet**
- The app might not have sent the token yet
- Check iOS console logs (see below)

---

## 🪵 Step 3: Check iOS Console Logs (Optional but Helpful)

If you have a Mac with Xcode:

1. Connect your iPhone via USB
2. Open Xcode
3. Window → Devices and Simulators
4. Select your iPhone
5. Click "Open Console" button
6. Filter by "Push" or "C-Point"

### What to look for:

**✅ Good signs:**
```
🔔 Initializing native push notifications...
🔔 Permission granted! Registering for push...
Push registration success, token: abc123def456...
```

**❌ Error signs:**
```
🔔 ❌ Push notification permission not granted
Push registration error: ...
Failed to register push token with backend: ...
```

---

## 🔐 Step 4: Log In to Associate Token

1. **Log in** as Paulo in the TestFlight app
2. **Wait 5 seconds** after successful login
3. The backend should automatically associate any anonymous tokens with Paulo's account

**Check database again:**
```sql
SELECT * FROM push_tokens WHERE username = 'Paulo';
```

Should now show:
```
| id | username | token        | platform | created_at          |
|----|----------|--------------|----------|---------------------|
| 2  | Paulo    | <long token> | ios      | 2025-11-23 21:15:00 |
```

---

## 🧪 Step 5: Send Test Notification

Once token is associated with Paulo:

```bash
cd /workspace
export MYSQL_PASSWORD='5r4VN4Qq'
python3 test_send_apns.py Paulo
```

**Expected output:**
```
✅ Token found for Paulo
✅ JWT token generated
✅ Notification sent successfully
```

**Check iPhone:**
- Should receive a push notification
- If app is closed: Notification appears in notification center
- If app is open: Check console logs for "Push notification received"

---

## 🔧 Troubleshooting

### Issue 1: No token in database after opening app

**Possible causes:**
1. iOS didn't grant permission
2. App crashed during registration
3. Network error sending to backend

**Solutions:**
- Check iPhone Settings → C-Point → Notifications (must be ON)
- Check iOS console logs for errors
- Force quit and reopen app
- Check server error logs

### Issue 2: Token registered but not associated with Paulo after login

**Possible causes:**
1. Anonymous token older than 10 minutes (excluded by association logic)
2. Login didn't trigger association

**Solutions:**
- Check if token username is still `anonymous_...`:
```sql
SELECT * FROM push_tokens WHERE username LIKE 'anonymous_%';
```

- Manually associate it:
```sql
UPDATE push_tokens 
SET username = 'Paulo' 
WHERE username LIKE 'anonymous_%' AND platform = 'ios';
```

### Issue 3: Token exists but notification not received

**Possible causes:**
1. APNS environment mismatch (sandbox vs production)
2. APNS credentials issue
3. Token is invalid/expired

**Solutions:**
- Verify APNS environment in WSGI:
```python
os.environ['APNS_USE_SANDBOX'] = 'true'  # Should be 'true' for TestFlight
```

- Check test script output for detailed error messages
- Try regenerating token by uninstalling and reinstalling app

### Issue 4: "No active iOS token found for user: Paulo"

**Solutions:**
- Verify token exists in database:
```sql
SELECT * FROM push_tokens WHERE username = 'Paulo' AND platform = 'ios' AND is_active = 1;
```

- If missing, repeat Steps 1-4

---

## ✅ Success Checklist

- [ ] Endpoint returns 200 (not 401)
- [ ] Test token registered in database
- [ ] iPhone has notifications enabled in Settings
- [ ] Opened TestFlight app after reload
- [ ] Token appears in database (anonymous or Paulo)
- [ ] Logged in as Paulo
- [ ] Token associated with Paulo (not anonymous)
- [ ] Test notification sent successfully
- [ ] Notification received on iPhone

---

## 📝 Quick SQL Queries

### Check all tokens:
```sql
SELECT * FROM push_tokens ORDER BY created_at DESC;
```

### Check Paulo's tokens:
```sql
SELECT * FROM push_tokens WHERE username = 'Paulo';
```

### Check anonymous tokens:
```sql
SELECT * FROM push_tokens WHERE username LIKE 'anonymous_%';
```

### Manually associate anonymous token:
```sql
UPDATE push_tokens 
SET username = 'Paulo' 
WHERE username LIKE 'anonymous_%' AND platform = 'ios';
```

### Delete test token:
```sql
DELETE FROM push_tokens WHERE token = 'test_token_works';
```

---

## 🆘 If Still Not Working

Share the following information:

1. **Database query results:**
```sql
SELECT * FROM push_tokens ORDER BY created_at DESC LIMIT 5;
```

2. **iPhone notification settings:**
   - Settings → C-Point → Notifications → Screenshot

3. **iOS console logs** (if available):
   - Filter by "Push" keyword

4. **Server logs** (when opening app):
   - Check for "POST /api/push/register_native"

5. **Test script output:**
```bash
python3 test_send_apns.py Paulo
```

---

Good luck! 🚀
