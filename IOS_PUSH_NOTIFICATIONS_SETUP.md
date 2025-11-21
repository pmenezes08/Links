# iOS Push Notifications Setup Guide

## Current Status
✅ **Permissions Configured**: Info.plist has NSUserNotificationsUsageDescription
✅ **Frontend Code**: PushInit.tsx requests permissions and registers device token
✅ **Backend Endpoint**: `/api/push/register_native` receives and logs tokens

## What You'll See in iOS Settings

After rebuilding the app with `npx cap sync ios`, the notification option should appear in:
**Settings → C.Point → Notifications**

## Required Steps to Enable Push Notifications

### 1. Enable Push Notification Capability in Xcode
1. Open your iOS project in Xcode: `npx cap open ios`
2. Select the **App** target in the left sidebar
3. Go to **Signing & Capabilities** tab
4. Click **+ Capability**
5. Add **Push Notifications**
6. Add **Background Modes** and enable:
   - Remote notifications
   - Background fetch

### 2. Apple Developer Account Setup
To actually send push notifications, you need:

1. **Apple Developer Account** (paid, $99/year)
2. **APNs Authentication Key** or **APNs Certificate**
   - Go to https://developer.apple.com/account
   - Navigate to **Certificates, Identifiers & Profiles**
   - Create an **APNs Key** (recommended) or **APNs Certificate**
   - Download the .p8 key file

### 3. Backend APNs Integration
The backend needs to be configured to send notifications via APNs:

```python
# Install library:
pip install pyapns2

# In backend code:
from apns2.client import APNsClient
from apns2.payload import Payload

# Configure APNs client with your .p8 key
credentials = APNsCredentials(
    key_path='/path/to/APNs_Key.p8',
    key_id='YOUR_KEY_ID',
    team_id='YOUR_TEAM_ID'
)

client = APNsClient(credentials, use_sandbox=False)

# Send notification
payload = Payload(alert="You have a new message!", badge=1)
client.send_notification(device_token, payload, topic='co.cpoint.app')
```

### 4. Store Device Tokens
Modify `/api/push/register_native` endpoint to:
- Store tokens in database (user_id, token, platform, created_at)
- Handle token refresh
- Clean up expired tokens

## Testing Without Full Setup

### Option 1: Verify Permission Request
Run the app and check Xcode console logs for:
```
🔔 Initializing native push notifications...
🔔 Requesting push notification permissions...
🔔 Permission result: {...}
```

If you see permission errors, the capability might not be enabled in Xcode.

### Option 2: Test with Simulator
Note: iOS Simulator **cannot** receive real push notifications!
You MUST test on a physical device.

### Option 3: Manual Test Push (requires APNs setup)
Use tools like:
- Pusher (macOS app for testing APNs)
- Houston (command-line APNs testing tool)

## Troubleshooting

### "Notifications not showing in Settings"
- Run `npx cap sync ios` after adding the plugin
- Clean build in Xcode (Cmd+Shift+K)
- Check that Push Notifications capability is enabled in Xcode

### "Permission request not appearing"
- Check Xcode console for errors
- Verify @capacitor/push-notifications is installed
- Check that Info.plist has NSUserNotificationsUsageDescription

### "Permission granted but no notifications"
- APNs credentials not configured on backend
- App not built with proper provisioning profile
- Testing on simulator instead of real device

## Production Checklist

- [ ] Enable Push Notifications capability in Xcode
- [ ] Create APNs Key in Apple Developer account
- [ ] Configure backend with APNs credentials
- [ ] Store device tokens in database
- [ ] Implement notification sending logic
- [ ] Test on physical iOS device
- [ ] Set up notification content and deep linking
- [ ] Handle token refresh and cleanup
