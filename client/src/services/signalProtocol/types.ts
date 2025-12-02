/**
 * Signal Protocol Types for Multi-Device E2E Encryption
 */

// Device information
export interface DeviceInfo {
  deviceId: number
  deviceName: string
  registrationId: number
  createdAt: string
  lastSeenAt?: string
}

// PreKey bundle from server (for establishing session)
export interface PreKeyBundle {
  identityKey: string      // Base64 encoded public identity key
  registrationId: number
  deviceId: number
  signedPreKey: {
    keyId: number
    publicKey: string      // Base64
    signature: string      // Base64
  }
  preKey?: {               // Optional one-time prekey
    keyId: number
    publicKey: string      // Base64
  }
}

// Local device registration data
export interface DeviceRegistration {
  deviceId: number
  deviceName: string
  registrationId: number
  identityKeyPair: {
    publicKey: string      // Base64
    privateKey: string     // Base64
  }
  signedPreKey: {
    keyId: number
    publicKey: string
    privateKey: string
    signature: string
    timestamp: number
  }
  preKeys: Array<{
    keyId: number
    publicKey: string
    privateKey: string
  }>
}

// Encrypted message for a specific device
export interface DeviceCiphertext {
  targetUsername: string
  targetDeviceId: number
  senderDeviceId: number
  ciphertext: string       // Base64 encoded
  messageType: number      // 1 = PreKey message, 3 = regular message
}

// Message to be sent (before encryption)
export interface OutgoingMessage {
  recipientUsername: string
  plaintext: string
  timestamp: number
}

// Received encrypted message
export interface IncomingMessage {
  messageId: number
  senderUsername: string
  senderDeviceId: number
  ciphertext: string
  messageType: number
  timestamp: string
}

// Session state stored in IndexedDB
export interface StoredSession {
  address: string          // "username.deviceId"
  record: string           // Serialized session
  updatedAt: number
}

// Identity key stored in IndexedDB
export interface StoredIdentity {
  address: string          // "username" or "username.deviceId"
  publicKey: string        // Base64
  trusted: boolean
  addedAt: number
}

// Stored PreKey
export interface StoredPreKey {
  keyId: number
  publicKey: string
  privateKey: string
}

// Stored SignedPreKey
export interface StoredSignedPreKey {
  keyId: number
  publicKey: string
  privateKey: string
  signature: string
  timestamp: number
}

// Server response types
export interface RegisterDeviceResponse {
  success: boolean
  deviceId?: number
  error?: string
}

export interface GetDevicesResponse {
  success: boolean
  devices?: DeviceInfo[]
  error?: string
}

export interface GetPreKeyBundleResponse {
  success: boolean
  bundle?: PreKeyBundle
  error?: string
}

export interface GetAllPreKeyBundlesResponse {
  success: boolean
  bundles?: PreKeyBundle[]
  error?: string
}

// Encryption result
export interface EncryptionResult {
  deviceCiphertexts: DeviceCiphertext[]
  failedDevices: Array<{
    deviceId: number
    error: string
  }>
}

// Decryption result
export interface DecryptionResult {
  plaintext: string
  senderAddress: string
}
