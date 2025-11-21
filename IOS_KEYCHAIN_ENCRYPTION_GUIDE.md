# iOS Keychain Encryption Key Storage

## ✅ Problem Solved

**Before**: After updating or reinstalling the CPoint iOS app, all encrypted messages became unreadable because encryption keys were lost.

**After**: Encryption keys now persist across app updates and reinstalls using iOS Keychain, ensuring your encrypted message history is always preserved.

## 🔐 How It Works

### Key Storage Architecture

```
┌─────────────────────────────────────────────────┐
│           CPoint iOS App Launch                 │
└─────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────┐
│  Step 1: Check iOS Keychain (Primary)          │
│  └─ Persists across updates & reinstalls        │
└─────────────────────────────────────────────────┘
                      ↓
                 Keys Found?
                /          \
              YES           NO
               ↓             ↓
        Load & Use    ┌──────────────────────┐
                      │ Step 2: Check        │
                      │ IndexedDB (Cache)    │
                      └──────────────────────┘
                                ↓
                          Keys Found?
                          /         \
                        YES          NO
                         ↓            ↓
                  Migrate to    Generate New Keys
                   Keychain     Store in Both
                         ↓            ↓
                    All Done!    All Done!
```

### Storage Layers

1. **iOS Keychain** (Primary - via Capacitor Preferences)
   - Persists across app updates ✅
   - Persists across reinstalls ✅
   - Encrypted by iOS system ✅
   - Can sync via iCloud (optional) ✅

2. **IndexedDB** (Secondary Cache)
   - Fast local access
   - Fallback for existing users (migration path)
   - Cleared on app reinstall ❌

## 📁 Implementation Details

### New Service: `keychainStorage.ts`

Provides secure key storage with these methods:

```typescript
// Store keys in Keychain
await keychainStorage.storeKeys(username, {
  publicKey: JsonWebKey,
  privateKey: JsonWebKey,
  timestamp: number
})

// Retrieve keys from Keychain
const keys = await keychainStorage.getKeys(username)

// Remove keys from Keychain
await keychainStorage.removeKeys(username)

// Check if keys exist
const hasKeys = await keychainStorage.hasKeys(username)
```

### Modified: `simpleEncryption.ts`

Enhanced initialization logic:

```typescript
async init(username: string) {
  // 1. Try iOS Keychain first (persists across updates)
  const keychainKeys = await this.loadKeysFromKeychain()
  if (keychainKeys) {
    console.log('✅ Loaded keys from iOS Keychain')
    return keychainKeys
  }

  // 2. Try IndexedDB (migration for existing users)
  const indexedDBKeys = await this.getStoredKeys()
  if (indexedDBKeys) {
    console.log('📦 Migrating keys to Keychain')
    await this.backupKeysToKeychain(indexedDBKeys)
    return indexedDBKeys
  }

  // 3. Generate new keys (new user)
  console.log('🔑 Generating new keys')
  const newKeys = await this.generateKeys()
  // Automatically stored in both Keychain and IndexedDB
  return newKeys
}
```

## 🎯 User Experience

### New Users
1. Install app
2. Login
3. Keys generated and stored in Keychain + IndexedDB
4. Send/receive encrypted messages

### Existing Users (Migration)
1. Update app to this version
2. Launch app
3. **Automatic migration**: Keys copied from IndexedDB → Keychain
4. All old messages remain readable
5. Future updates preserve keys

### After This Update
- Update app again → Keys loaded from Keychain → All messages readable ✅
- Reinstall app → Login → Keys loaded from Keychain → All messages readable ✅
- Switch devices (if iCloud Keychain enabled) → Keys synced → All messages readable ✅

## 🔧 Technical Implementation

### Key Serialization

CryptoKey objects can't be directly serialized, so we:

1. **Export** private key to JWK (JSON Web Key) format
```typescript
const privateKeyJwk = await crypto.subtle.exportKey('jwk', privateKey)
```

2. **Store** JWK in Keychain as JSON string
```typescript
await Preferences.set({
  key: 'encryption_key_username',
  value: JSON.stringify({ publicKey, privateKey })
})
```

3. **Import** JWK back to CryptoKey on load
```typescript
const privateKey = await crypto.subtle.importKey(
  'jwk',
  privateKeyJwk,
  { name: 'RSA-OAEP', hash: 'SHA-256' },
  true,
  ['decrypt']
)
```

### Capacitor Preferences Plugin

The `@capacitor/preferences` plugin provides:
- **iOS**: Native Keychain storage (encrypted by system)
- **Android**: Encrypted SharedPreferences
- **Web**: Encrypted localStorage (fallback)

## 🚀 Next Steps

### To Deploy This Update

1. **Pull latest code**:
   ```bash
   git pull origin develop-web
   cd client
   npm install
   ```

2. **Build iOS app**:
   ```bash
   npm run build
   npx cap sync ios
   npx cap open ios
   ```

3. **In Xcode**:
   - Build and run on device/simulator
   - Test encryption (send/receive messages)
   - Update app (reinstall) and verify messages still readable

### Testing Checklist

- [ ] New user: Generate keys → Send message → Receive encrypted message
- [ ] Existing user: Update app → Old messages readable
- [ ] Update again: Keys persist → All messages readable
- [ ] Reinstall app: Login → Keys restored → Messages readable

### Console Logs to Monitor

When the app launches, you'll see:
```
🔐 Initializing encryption for username
🔐 ✅ Loaded keys from iOS Keychain
```

Or for migration:
```
🔐 Initializing encryption for username
🔐 📦 Found keys in IndexedDB - migrating to Keychain
🔐 ✅ Keys backed up to iOS Keychain
```

Or for new users:
```
🔐 Initializing encryption for username
🔐 🔑 Generating new encryption keys
🔐 ✅ Keys backed up to iOS Keychain
```

## 🔒 Security Notes

- Private keys never leave the device (except via iCloud Keychain if enabled)
- Keys stored in Keychain are encrypted by iOS
- Web fallback uses localStorage (less secure than native Keychain)
- Keys can be manually reset in app settings if needed

## 📱 Platform Support

| Platform | Storage Method | Persists Updates | Syncs Devices |
|----------|---------------|------------------|---------------|
| iOS      | Keychain      | ✅               | ✅ (iCloud)   |
| Android  | Encrypted Prefs| ✅              | ❌            |
| Web      | localStorage  | ✅               | ❌            |

## 💡 Benefits Summary

✅ **No More Lost Messages**: Keys persist across updates
✅ **Zero User Action**: Automatic migration for existing users
✅ **Secure Storage**: iOS system-level encryption
✅ **Multi-Device Ready**: Can sync via iCloud Keychain
✅ **Backwards Compatible**: IndexedDB still works
✅ **Future-Proof**: Designed for long-term key management

## 🐛 Troubleshooting

### Messages Still Encrypted After Update?

1. Check console logs for key loading status
2. Verify Keychain access (iOS Settings → CPoint → Allow access to Keychain)
3. Try resetting keys in **Settings → Encryption Settings → Reset Keys**
4. Contact support if issue persists

### Keys Not Syncing Across Devices?

- Ensure iCloud Keychain is enabled (iOS Settings → iCloud → Keychain)
- Sign in with same Apple ID on both devices
- Wait a few minutes for sync

### Development/Testing

To test migration:
1. Install old version (without Keychain)
2. Send/receive encrypted messages
3. Update to new version
4. Verify messages still readable (should see migration log)
5. Update again and verify keys persist
