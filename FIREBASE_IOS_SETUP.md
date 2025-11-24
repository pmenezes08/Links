# Firebase iOS Push Notifications Setup Guide

## Overview

This guide will help you set up Firebase Cloud Messaging (FCM) for iOS push notifications in your Links app. The implementation supports both web push notifications (existing) and native iOS push notifications via Firebase.

## Prerequisites

1. **Firebase Project**: Create a Firebase project at https://console.firebase.google.com/
2. **Apple Developer Account**: For push notification certificates
3. **Xcode**: For iOS development (though you're using remote MacinCloud)

## Step 1: Firebase Console Setup

### 1.1 Create Firebase Project
1. Go to https://console.firebase.google.com/
2. Click "Create a project" (or select existing project)
3. Enter your project name (e.g., "links-app")
4. Enable Google Analytics if desired
5. Choose your Google Analytics account

### 1.2 Add iOS App to Firebase
1. In your Firebase project, click the iOS icon to add an iOS app
2. Enter your iOS bundle ID (check your `capacitor.config.ts` or Xcode project)
3. Download the `GoogleService-Info.plist` file
4. **Don't follow the remaining Firebase setup steps** - we'll handle those manually

### 1.3 Generate Service Account Key
1. In Firebase Console, go to Project Settings (gear icon)
2. Go to "Service accounts" tab
3. Click "Generate new private key"
4. Download the JSON file - this is your service account credentials
5. **Keep this file secure and never commit it to version control**

## Step 2: Server-Side Configuration

### 2.1 Install Dependencies
The Firebase Admin SDK has been added to `requirements.txt`. Install it:

```bash
pip install firebase-admin==6.2.0
```

### 2.2 Configure Environment Variables
Add to your `.env` file:

```bash
# Firebase service account credentials path
FIREBASE_CREDENTIALS_PATH=/path/to/your/firebase-service-account-key.json
```

**Important**: Place your downloaded service account JSON file in a secure location on your server (outside the web root).

### 2.3 Database Migration
The FCM token storage has been added to the backend. The `fcm_tokens` table will be created automatically when the API is first called.

## Step 3: iOS App Configuration

### 3.1 Add GoogleService-Info.plist
1. Copy your downloaded `GoogleService-Info.plist` to: `client/ios/App/App/GoogleService-Info.plist`
2. **Do not commit this file to version control** - add it to `.gitignore`

### 3.2 Configure React App Environment
Create/update `client/.env.local`:

```bash
REACT_APP_FIREBASE_API_KEY=your_api_key_from_google_services_plist
REACT_APP_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
REACT_APP_FIREBASE_PROJECT_ID=your_project_id
REACT_APP_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
REACT_APP_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
REACT_APP_FIREBASE_APP_ID=your_app_id
REACT_APP_FIREBASE_VAPID_KEY=your_vapid_key_from_firebase_console
```

Get these values from your `GoogleService-Info.plist`:
- `API_KEY` → `REACT_APP_FIREBASE_API_KEY`
- `PROJECT_ID` → `REACT_APP_FIREBASE_PROJECT_ID`
- `GCM_SENDER_ID` → `REACT_APP_FIREBASE_MESSAGING_SENDER_ID`
- `GOOGLE_APP_ID` → `REACT_APP_FIREBASE_APP_ID`

### 3.3 Build and Deploy iOS App
Since you're using MacinCloud, you'll need to:

1. **Update CocoaPods**:
   ```bash
   cd client/ios/App
   pod install
   ```

2. **Build the iOS app** using Xcode on your MacinCloud instance

3. **Configure Push Notifications Certificate**:
   - In Apple Developer Console, create a Push Notification certificate for your app
   - Download the certificate and install it in your MacinCloud Keychain
   - In Xcode, enable Push Notifications capability for your app target

## Step 4: Testing

### 4.1 Test Token Registration
1. Build and install the iOS app on a test device
2. Log in to your app
3. Check server logs for: `"Registering FCM token for user X on platform ios"`
4. Verify in database: `SELECT * FROM fcm_tokens WHERE username = 'your_username';`

### 4.2 Test Push Notifications
1. Send a test notification from the admin panel or trigger a poll/event notification
2. Check server logs for FCM send attempts
3. Verify push notification appears on device

## Step 5: Debugging Common Issues

### Issue: "FCM token not registering"
**Check**:
- Firebase configuration in React app (`.env.local`)
- `GoogleService-Info.plist` is present and correct
- iOS app has notification permissions
- Server can access Firebase credentials file

**Debug**: Check browser console and Xcode logs for Firebase initialization errors.

### Issue: "Firebase not initialized"
**Check**:
- `FIREBASE_CREDENTIALS_PATH` environment variable points to valid JSON file
- Service account JSON has correct permissions
- `firebase-admin` package is installed

**Debug**: Check Flask logs for Firebase initialization errors.

### Issue: "Push notifications not received"
**Check**:
- iOS device has notifications enabled for your app
- Push certificate is correctly installed and matches bundle ID
- FCM tokens are being stored in database
- Server can send to FCM (check response codes)

**Debug**: Use Firebase Console's "Cloud Messaging" → "Send test message" to verify FCM works.

### Issue: "APNs certificate issues"
**Check**:
- Push notification certificate is for the correct environment (development/production)
- Certificate is installed in MacinCloud Keychain
- App is signed with the correct provisioning profile

## File Changes Made

The following files have been updated for Firebase integration:

### Backend
- `requirements.txt`: Added firebase-admin SDK
- `bodybuilding_app.py`: Added `/api/fcm/register_token` endpoint
- `backend/services/notifications.py`: Added FCM push notification support
- `.env.example`: Added FIREBASE_CREDENTIALS_PATH

### Frontend
- `client/package.json`: Added Firebase and Capacitor push notification packages
- `client/src/services/firebase.ts`: Firebase configuration and token management
- `client/src/components/FirebasePushInit.tsx`: React component for FCM setup
- `client/src/App.tsx`: Added FirebasePushInit component
- `client/capacitor.config.ts`: (Empty, may need Firebase plugin config)
- `client/ios/App/Podfile`: Added Firebase/Messaging pod
- `client/ios/App/App/AppDelegate.swift`: Added Firebase initialization and FCM handling
- `client/ios/App/App/Info.plist`: Added push notification capabilities

### Configuration Templates
- `client/.env.example`: Firebase environment variables template
- `client/ios/App/App/GoogleService-Info.plist.template`: iOS Firebase config template
- `firebase-service-account-key.json.template`: Server credentials template

## Next Steps

1. Complete Firebase Console setup
2. Configure your server with Firebase credentials
3. Set up iOS push certificates on MacinCloud
4. Test token registration and push notifications
5. Monitor logs and debug any issues

If you encounter issues, check the logs and ensure all configuration files are properly set up with your actual Firebase project values.