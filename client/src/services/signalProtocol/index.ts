/**
 * Signal Protocol Multi-Device Encryption
 * 
 * This module provides end-to-end encryption using the Signal Protocol
 * with full multi-device support. Each device has its own identity keys,
 * and messages are encrypted separately for each recipient device.
 * 
 * Usage:
 * 
 * 1. Initialize on login:
 *    const { isNewDevice, deviceId } = await signalService.init(username)
 * 
 * 2. Encrypt a message:
 *    const result = await signalService.encryptMessage(recipientUsername, plaintext)
 *    // result.deviceCiphertexts contains encrypted messages for each device
 * 
 * 3. Decrypt a message:
 *    const { plaintext } = await signalService.decryptMessage(
 *      senderUsername,
 *      senderDeviceId,
 *      ciphertext,
 *      messageType
 *    )
 */

export { signalService } from './SignalService'
export { signalStore } from './SignalStore'
export type {
  DeviceInfo,
  DeviceRegistration,
  PreKeyBundle,
  DeviceCiphertext,
  EncryptionResult,
  DecryptionResult,
  OutgoingMessage,
  IncomingMessage,
} from './types'
