# 🔧 Xcode Push Notifications Setup (Required!)

## Why Notifications Aren't Working

Your Xcode console shows:
```
🔔 Permission granted! Registering for push...
🔔 Registration initiated
```

But **NO token is received**. This means the **Push Notifications capability isn't enabled in Xcode.**

---

## ✅ Fix: Enable Push Notifications in Xcode

### Step 1: Open Your Project in Xcode

```bash
cd client
npx cap open ios
```

### Step 2: Select Your App Target

1. Click on **App** (blue icon) in left sidebar
2. Select **App** target (not App (iOS))
3. Click **Signing & Capabilities** tab

### Step 3: Add Push Notifications Capability

1. Click **+ Capability** button (top left of capabilities section)
2. Search for **"Push Notifications"**
3. Double-click **"Push Notifications"** to add it

You should now see:
```
✅ Push Notifications
```

in your capabilities list.

### Step 4: Add Background Modes

1. Click **+ Capability** again
2. Search for **"Background Modes"**
3. Double-click **"Background Modes"** to add it
4. Check these boxes:
   - ☑️ **Remote notifications**

### Step 5: Verify Signing

Make sure your app is signed:
1. In **Signing & Capabilities** tab
2. Check **Automatically manage signing** is enabled
3. Select your **Team** from dropdown
4. Verify **Signing Certificate** shows a valid certificate

---

## 🔄 Step 6: Clean Build & Run

After adding capabilities:

1. **Product → Clean Build Folder** (Cmd+Shift+K)
2. **Product → Build** (Cmd+B)
3. **Run on your iPhone** (Cmd+R)

---

## ✅ Step 7: Verify It Works

After rebuilding, watch Xcode console for:

**✅ Success - You should see:**
```
🔔 Permission granted! Registering for push...
🔔 Registration initiated
Push registration success, token: abc123def456...  ← THIS LINE IS KEY!
```

**❌ If still no token:**
- Check capabilities were saved
- Try running on a real device (not simulator)
- Check provisioning profile includes push entitlements

---

## 🔍 Common Issues

### "No token received"
- **Cause**: Push Notifications capability not added
- **Fix**: Follow Step 3 above

### "entitlement not allowed"
- **Cause**: Free developer account
- **Fix**: Need paid Apple Developer account ($99/year)

### "No provisioning profile"
- **Cause**: App not signed
- **Fix**: Enable "Automatically manage signing"

### "Testing on Simulator"
- **Cause**: Simulator doesn't support real push notifications
- **Fix**: Test on real iPhone device

---

## 📊 After Adding Capabilities:

Your app will:
1. ✅ Request permission (already works)
2. ✅ Get device token from Apple (NEW - will work after this)
3. ✅ Send token to backend (already implemented)
4. ⚠️ Backend stores token (needs push_tokens table)
5. ❌ Backend sends push (needs APNs credentials)

**You're making progress! This step (Xcode capabilities) is critical.** After this, you'll need APNs credentials to actually send notifications.

---

## 🎯 Checklist:

- [ ] Open Xcode
- [ ] Add Push Notifications capability
- [ ] Add Background Modes capability
- [ ] Check Remote notifications
- [ ] Clean build
- [ ] Run on real iPhone
- [ ] Watch console for token

---

## 📱 After This Works:

You'll see in Xcode console:
```
Push registration success, token: abc123...
```

And in your backend logs:
```
📱 Registered new push token for admin on ios
```

And in MySQL:
```sql
SELECT * FROM push_tokens WHERE username = 'admin';
-- Will show 1 row with your device token
```

**Then you'll need APNs credentials to actually send notifications** (see `IOS_APNS_SETUP_COMPLETE_GUIDE.md`).

---

## 🚀 Do This First:

Add the Xcode capabilities, rebuild, and share the new console output. If you see the token appear, we're making progress! 📱
