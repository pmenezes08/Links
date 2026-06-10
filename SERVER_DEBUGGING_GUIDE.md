# 🔧 Server-Side Push Notification Debugging Guide

## Quick Start

On your Cloud Run server, run these commands:

```bash
cd /home/puntz08/WorkoutX/Links
git pull origin main

# Run comprehensive test
python3.10 test_push_server_detailed.py
```

---

## 🎯 What Each Script Does

### **1. test_push_server_detailed.py** (Main Test Script)

This is your **primary debugging tool**. It:

✅ Checks Firebase environment variables  
✅ Verifies Firebase Admin SDK is installed  
✅ Tests Firebase initialization  
✅ Connects to database  
✅ Shows all of Paulo's tokens (with details)  
✅ Attempts to send a test notification  
✅ Shows detailed error messages with solutions

**Run it:**
```bash
python3.10 test_push_server_detailed.py
```

**Expected output if working:**
```
🔍 PUSH NOTIFICATION SERVER DEBUGGING
============================================================
1️⃣  Checking environment variables...
   ✅ FIREBASE_CREDENTIALS is set
   ✅ File exists
   ✅ File size: 2847 bytes

2️⃣  Importing Firebase Admin SDK...
   ✅ Firebase Admin SDK imported successfully

3️⃣  Checking Firebase initialization...
   ✅ Firebase already initialized

4️⃣  Checking database connection...
   ✅ Database connection established

5️⃣  Checking tokens for Paulo...
   📊 fcm_tokens table: 1 token(s)
   Token 1: ✅ abc123def456...
      Platform: ios
      Device: iPhone
      Created: 2025-11-24 20:00:00
      Last seen: 2025-11-24 20:00:00

6️⃣  Attempting to send test notification...
   📱 Using token: abc123def456...
   📱 Platform: ios

7️⃣  Building Firebase message...
   ✅ Message built successfully

8️⃣  Sending notification via Firebase...
   ✅ SUCCESS! Message sent!
   📨 Firebase response: projects/.../messages/...

🎉 Check Paulo's iPhone - you should see the notification!
```

---

### **2. check_server_logs.sh** (Log Viewer)

Quickly scan server logs for push-related activity.

**Run it:**
```bash
bash check_server_logs.sh
```

**Shows:**
- Recent Firebase/FCM errors
- API calls to `/api/push/register_fcm`
- General errors

---

### **3. insert_test_token.py** (Manual Token Insert)

Insert a token manually for testing (if iOS app isn't registering).

**Run it:**
```bash
python3.10 insert_test_token.py
```

**When to use:**
- iOS app won't register tokens
- Need to test server independently
- Want to verify Firebase sending works

---

## 🧪 Testing Scenarios

### **Scenario 1: No tokens for Paulo**

**You'll see:**
```
5️⃣  Checking tokens for Paulo...
   📊 fcm_tokens table: 0 token(s)
❌ No FCM tokens found for Paulo!
```

**What this means:**
- iOS app never registered a token
- Problem is on iOS side, not server
- Fix iOS app registration first

**Action:**
1. Fix iOS app (GoogleService-Info.plist issue)
2. Or manually insert a test token to verify server works

---

### **Scenario 2: Token exists but sending fails**

**You might see:**
```
8️⃣  Sending notification via Firebase...
   ❌ Token is invalid or unregistered!
   Error: The registration token is not a valid FCM registration token
```

**What this means:**
- Token in database is invalid/expired
- Token might be from wrong Firebase project
- Token might be fake/corrupted

**Solutions:**
- **UnregisteredError**: Token expired, mark as inactive
- **SenderIdMismatchError**: iOS app has wrong GoogleService-Info.plist
- **InvalidArgumentError**: Token format is wrong

---

### **Scenario 3: Firebase not initialized**

**You'll see:**
```
3️⃣  Checking Firebase initialization...
   ⚠️  Firebase not initialized
   ✅ Firebase initialized successfully
```

**What this means:**
- First time running, or app restarted
- This is normal if app just started

---

### **Scenario 4: Firebase credentials missing**

**You'll see:**
```
1️⃣  Checking environment variables...
   ❌ FIREBASE_CREDENTIALS not set!
```

**Fix:**
```bash
# Add to WSGI file
os.environ['FIREBASE_CREDENTIALS'] = '/home/puntz08/secrets/cpoint-127c2-firebase-adminsdk-fbsvc-1f900dabeb.json'

# Reload web app in Cloud Run dashboard
```

---

## 📊 Common Error Messages

### **Error: "No module named 'firebase_admin'"**

**Fix:**
```bash
source ~/.virtualenvs/WorkoutXenv/bin/activate
pip install firebase-admin
```

---

### **Error: "The default Firebase app already exists"**

**Ignore** - This is normal, script handles it.

---

### **Error: "Sender ID mismatch"**

**Problem:** iOS app has wrong Firebase project

**Fix:**
1. Download correct GoogleService-Info.plist from Firebase Console
2. Project: `cpoint-127c2`
3. Bundle ID: `co.cpoint.app`
4. Replace in iOS app

---

### **Error: "Token is not a valid FCM registration token"**

**Problem:** Token format is wrong or corrupted

**Fix:**
1. Delete token from database
2. Re-register from iOS app
3. Token should be 152+ characters

---

## 🔬 Advanced: Manual Token Test

If iOS app won't register, test server with a manual token:

```bash
# Insert fake token
python3.10 insert_test_token.py
# (Press Enter to use fake token, or paste a real one)

# Try sending (will fail but tests server logic)
python3.10 test_push_server_detailed.py
```

**Expected result:**
- Server logic works ✅
- Firebase SDK works ✅
- Token is fake so sending fails ❌
- This proves server is OK, problem is iOS token generation

---

## 📋 Debugging Checklist

Run these in order:

```bash
cd /home/puntz08/WorkoutX/Links
git pull origin main

# 1. Check logs for errors
bash check_server_logs.sh

# 2. Run full diagnostic
python3.10 test_push_server_detailed.py

# 3. If no tokens, check if registration endpoint is called
tail -f /var/log/app.c-point.co.server.log | grep register_fcm

# 4. If still broken, check web app error log in real-time
tail -f /var/log/app.c-point.co.error.log
```

---

## 🎯 Success Criteria

You'll know the server works when:

1. ✅ `test_push_server_detailed.py` finds Paulo's tokens
2. ✅ Script successfully sends notification
3. ✅ Paulo's iPhone receives notification
4. ✅ No errors in output

If you get to step 2 (sends successfully) but Paulo doesn't receive:
- Problem is with iOS APNs configuration
- Check iOS app has correct entitlements
- Check iOS device has internet connection
- Check notification permissions are enabled

---

## 💡 Pro Tips

### **Monitor logs in real-time:**
```bash
tail -f /var/log/app.c-point.co.error.log | grep -i firebase
```

### **Check database directly:**
```bash
python3.10 << 'EOF'
import sys
sys.path.insert(0, '/home/puntz08/WorkoutX/Links')
from backend.services.database import get_db_connection

conn = get_db_connection()
cursor = conn.cursor()
cursor.execute("SELECT * FROM fcm_tokens WHERE username = 'Paulo'")
for row in cursor.fetchall():
    print(row)
cursor.close()
conn.close()
EOF
```

### **Test endpoint directly:**
```bash
curl -X POST https://www.c-point.co/api/push/register_fcm \
  -H "Content-Type: application/json" \
  -d '{"token":"test123","platform":"ios"}' \
  -v
```

---

## 📞 Next Steps

1. **Run the comprehensive test:**
   ```bash
   python3.10 test_push_server_detailed.py
   ```

2. **Share the output** - it will tell us exactly what's wrong:
   - Is Firebase initialized? ✅/❌
   - Does Paulo have tokens? ✅/❌
   - Can server send notifications? ✅/❌
   - What error (if any)?

3. **Based on output**, we'll know if:
   - ✅ Server is fine → Fix iOS app
   - ❌ Server has issues → Fix server
   - ⚠️ Tokens wrong → Fix token registration

---

**Run the script and share the output!** 🚀
