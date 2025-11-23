# 🔍 Debug: iOS Push Token Not Registering

## Issue
iOS app opens, allows notifications, but device token isn't being saved to database.

---

## 🎯 Root Cause Analysis

### The Registration Flow:
1. ✅ iOS app requests permission → User allows
2. ✅ iOS generates device token
3. ✅ App sends token to `/api/push/register_native`
4. ❓ **Backend endpoint requires authenticated session** ← LIKELY ISSUE
5. ❓ Token might not be saved if user isn't logged in

---

## 🔍 Check #1: Are You Logged In?

**The `/api/push/register_native` endpoint requires authentication:**

```python
username = session.get('username')
if not username:
    return jsonify({'success': False, 'error': 'Not authenticated'}), 401
```

### Solution:
1. **Open TestFlight app**
2. **LOG IN to your account** (username: Paulo)
3. **Allow notifications when prompted**
4. Token should now register!

---

## 🔍 Check #2: Does push_tokens Table Exist?

Run this to check:
```bash
bash check_push_tokens_table.sh
```

If table doesn't exist:
```bash
python add_push_tokens_table.py
```

---

## 🔍 Check #3: Check Server Logs

Look for these messages in your web app error logs:

**✅ Success:**
```
📱 Registered new push token for Paulo on ios
✅ Push token saved - Platform: ios, Token: abc123...
```

**❌ Auth Error:**
```
Error: Not authenticated
```

**❌ Database Error:**
```
Database error storing push token: Table 'push_tokens' doesn't exist
```

---

## 🛠️ Quick Fixes

### Fix 1: Make Sure You're Logged In
The most common issue! The app needs you to be logged in to register the token.

1. Open TestFlight app
2. **LOG IN** with username "Paulo"
3. Close and reopen app (to trigger registration again)
4. Check database:
   ```bash
   # Check if token was registered
   mysql -u puntz08 -p -h puntz08.mysql.pythonanywhere-services.com "puntz08\$C-Point" \
     -e "SELECT * FROM push_tokens WHERE username='Paulo'"
   ```

### Fix 2: Create push_tokens Table (If Missing)
```bash
python add_push_tokens_table.py
```

### Fix 3: Check Registration Endpoint
Test the endpoint manually (while logged in on web):
```bash
curl -X POST https://your-app.com/api/push/register_native \
  -H "Content-Type: application/json" \
  -H "Cookie: session=YOUR_SESSION_COOKIE" \
  -d '{"token": "test_token_123", "platform": "ios"}'
```

---

## 📊 Troubleshooting Steps

### Step 1: Verify You're Logged In
```bash
# In your browser/app, check if you're logged in
# Look for session cookie or user info in UI
```

### Step 2: Check Database Table
```bash
python3 -c "
import os, pymysql
os.environ['MYSQL_PASSWORD'] = 'YourPassword'
conn = pymysql.connect(
    host='puntz08.mysql.pythonanywhere-services.com',
    user='puntz08', 
    password=os.environ['MYSQL_PASSWORD'],
    database='puntz08\$C-Point'
)
cursor = conn.cursor()
cursor.execute('SHOW TABLES LIKE \"push_tokens\"')
if cursor.fetchone():
    print('✅ Table exists')
else:
    print('❌ Table missing - run: python add_push_tokens_table.py')
"
```

### Step 3: Check Recent Registrations
```bash
export MYSQL_PASSWORD='YourPassword'
mysql -u puntz08 -p"$MYSQL_PASSWORD" -h puntz08.mysql.pythonanywhere-services.com "puntz08\$C-Point" \
  -e "SELECT * FROM push_tokens ORDER BY created_at DESC LIMIT 5"
```

### Step 4: Monitor Live Registration
1. Open server error logs
2. Open TestFlight app (while logged in)
3. Watch for registration messages
4. Look for errors

---

## 🎯 Most Likely Issue: Not Logged In

The `/api/push/register_native` endpoint **requires an authenticated session**.

### Quick Test:
1. Open TestFlight app
2. **Make sure you're logged in as Paulo**
3. Force close the app (swipe up from multitasking)
4. Reopen the app
5. Check logs for: `📱 Registered new push token for Paulo on ios`

---

## 🔧 Temporary Workaround (For Testing)

If you want to test notifications without fixing authentication, you can manually insert a token:

```bash
# Get token from iOS app console logs (look for "Push registration success, token: ...")
export MYSQL_PASSWORD='YourPassword'
mysql -u puntz08 -p"$MYSQL_PASSWORD" -h puntz08.mysql.pythonanywhere-services.com "puntz08\$C-Point" <<EOF
INSERT INTO push_tokens (username, token, platform, is_active) 
VALUES ('Paulo', 'YOUR_DEVICE_TOKEN_HERE', 'ios', 1);
EOF
```

Then test:
```bash
python3 test_send_apns.py Paulo
```

---

## ✅ Success Checklist

- [ ] Logged in to TestFlight app as Paulo
- [ ] Allowed notifications when prompted
- [ ] push_tokens table exists in database
- [ ] Server logs show registration message
- [ ] Database query shows token for Paulo
- [ ] Test script successfully sends notification

---

## 🆘 Still Not Working?

1. **Check app console logs** (Xcode device logs) for errors
2. **Check server error logs** for `/api/push/register_native` failures
3. **Verify authentication** - can you access other authenticated endpoints?
4. **Check network** - is the API call reaching the server?

Share the error logs and I'll help debug further!
