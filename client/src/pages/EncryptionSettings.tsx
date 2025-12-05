import { useState, useEffect } from 'react'
import { useHeader } from '../contexts/HeaderContext'
import { encryptionService } from '../services/simpleEncryption'

export default function EncryptionSettings() {
  const { setTitle } = useHeader()
  const [keyStatus, setKeyStatus] = useState<'checking' | 'ready' | 'none' | 'needs_sync'>('checking')
  const [lastGenerated, setLastGenerated] = useState<string | null>(null)
  const [showSuccess, setShowSuccess] = useState(false)
  const [successMessage, setSuccessMessage] = useState('Keys Reset Successfully!')
  
  // Multi-device sync states
  const [showPasswordModal, setShowPasswordModal] = useState(false)
  const [modalMode, setModalMode] = useState<'backup' | 'restore' | 'regenerate'>('backup')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [hasServerBackup, setHasServerBackup] = useState(false)

  useEffect(() => {
    setTitle('Encryption Settings')
    checkKeyStatus()
  }, [setTitle])

  async function checkKeyStatus() {
    try {
      // Check local keys first
      const dbs = await indexedDB.databases()
      const encryptionDb = dbs.find(db => db.name === 'chat-encryption')
      const hasLocalKeys = !!encryptionDb
      
      // Check server status
      try {
        const response = await fetch('/api/encryption/has-keys', {
          credentials: 'include'
        })
        if (response.ok) {
          const data = await response.json()
          setHasServerBackup(data.hasBackup || false)
          
          if (!hasLocalKeys && data.hasKeys) {
            // Keys on server but not locally - need to sync
            setKeyStatus('needs_sync')
            return
          }
        }
      } catch {
        console.warn('Could not check server key status')
      }
      
      if (hasLocalKeys) {
        setKeyStatus('ready')
        const timestamp = localStorage.getItem('encryption_keys_generated_at')
        if (timestamp) {
          const date = new Date(parseInt(timestamp))
          setLastGenerated(date.toLocaleString())
        } else {
          setLastGenerated('Unknown')
        }
      } else {
        setKeyStatus('none')
      }
    } catch (error) {
      console.error('Error checking key status:', error)
      setKeyStatus('none')
    }
  }

  async function handleCreateBackup() {
    setModalMode('backup')
    setPassword('')
    setConfirmPassword('')
    setPasswordError('')
    setShowPasswordModal(true)
  }

  async function handleRestoreFromBackup() {
    setModalMode('restore')
    setPassword('')
    setPasswordError('')
    setShowPasswordModal(true)
  }

  async function handlePasswordSubmit() {
    setPasswordError('')
    
    if (modalMode === 'backup' || modalMode === 'regenerate') {
      if (password.length < 6) {
        setPasswordError('Password must be at least 6 characters')
        return
      }
      if (password !== confirmPassword) {
        setPasswordError('Passwords do not match')
        return
      }
    }
    
    setIsProcessing(true)
    
    try {
      if (modalMode === 'backup') {
        // Create backup with password
        const success = await encryptionService.createServerBackup(password)
        if (success) {
          setHasServerBackup(true)
          setShowPasswordModal(false)
          setSuccessMessage('Backup Created Successfully!')
          setShowSuccess(true)
          setTimeout(() => setShowSuccess(false), 5000)
        } else {
          setPasswordError('Failed to create backup')
        }
      } else if (modalMode === 'restore') {
        // Restore from backup
        const success = await encryptionService.restoreFromBackup(password)
        if (success) {
          setKeyStatus('ready')
          localStorage.setItem('encryption_keys_generated_at', Date.now().toString())
          setLastGenerated(new Date().toLocaleString())
          setShowPasswordModal(false)
          setSuccessMessage('Keys Synced Successfully!')
          setShowSuccess(true)
          setTimeout(() => setShowSuccess(false), 5000)
        } else {
          setPasswordError('Wrong password or backup corrupted')
        }
      } else if (modalMode === 'regenerate') {
        // Regenerate keys
        const success = await encryptionService.regenerateKeys(password)
        if (success) {
          setKeyStatus('ready')
          localStorage.setItem('encryption_keys_generated_at', Date.now().toString())
          setLastGenerated(new Date().toLocaleString())
          setHasServerBackup(true)
          setShowPasswordModal(false)
          setSuccessMessage('Keys Regenerated Successfully!')
          setShowSuccess(true)
          setTimeout(() => setShowSuccess(false), 5000)
        } else {
          setPasswordError('Failed to regenerate keys')
        }
      }
    } catch (error) {
      console.error('Password operation failed:', error)
      setPasswordError('Operation failed. Please try again.')
    } finally {
      setIsProcessing(false)
    }
  }

  async function resetEncryptionKeys() {
    if (!confirm('Reset your encryption keys?\n\nThis will:\n- Delete your current encryption keys\n- Generate fresh new keys\n- Allow you to send/receive encrypted messages again\n\nNote: Old encrypted messages may become unreadable.')) {
      return
    }

    // Use new regenerate flow with password
    setModalMode('regenerate')
    setPassword('')
    setConfirmPassword('')
    setPasswordError('')
    setShowPasswordModal(true)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-[#1a2f2a] to-gray-900 text-white pb-20">
      {/* Password Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 border border-white/20 rounded-2xl p-6 max-w-sm w-full shadow-2xl">
            <h3 className="text-xl font-bold text-white mb-2">
              {modalMode === 'backup' && '🔐 Create Backup'}
              {modalMode === 'restore' && '🔄 Sync from Backup'}
              {modalMode === 'regenerate' && '🔑 Regenerate Keys'}
            </h3>
            <p className="text-sm text-white/60 mb-4">
              {modalMode === 'backup' && 'Create a password to encrypt your key backup. You\'ll need this to sync on other devices.'}
              {modalMode === 'restore' && 'Enter your backup password to sync your encryption keys.'}
              {modalMode === 'regenerate' && 'Create a password for your new key backup.'}
            </p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-white/70 mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/30 focus:border-[#4db6ac] focus:outline-none"
                />
              </div>
              
              {(modalMode === 'backup' || modalMode === 'regenerate') && (
                <div>
                  <label className="block text-sm text-white/70 mb-1">Confirm Password</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm password"
                    className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/30 focus:border-[#4db6ac] focus:outline-none"
                  />
                </div>
              )}
              
              {passwordError && (
                <p className="text-red-400 text-sm">{passwordError}</p>
              )}
              
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowPasswordModal(false)}
                  className="flex-1 px-4 py-3 rounded-xl bg-white/10 text-white font-medium"
                  disabled={isProcessing}
                >
                  Cancel
                </button>
                <button
                  onClick={handlePasswordSubmit}
                  disabled={isProcessing}
                  className="flex-1 px-4 py-3 rounded-xl bg-[#4db6ac] text-white font-medium disabled:opacity-50"
                >
                  {isProcessing ? (
                    <i className="fa-solid fa-spinner fa-spin" />
                  ) : (
                    modalMode === 'restore' ? 'Sync' : 'Create'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Success Popup */}
      {showSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 border border-green-500/30 rounded-2xl p-6 max-w-sm w-full shadow-2xl animate-in fade-in zoom-in duration-200">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/20 flex items-center justify-center">
                <i className="fa-solid fa-check text-3xl text-green-400" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">{successMessage}</h3>
              <p className="text-sm text-white/60 mb-4">
                Your encryption keys are ready. You can now send and receive encrypted messages.
              </p>
              <button
                onClick={() => setShowSuccess(false)}
                className="w-full px-6 py-3 rounded-xl bg-green-600 hover:bg-green-700 text-white font-medium transition-all active:scale-95"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="app-content max-w-2xl mx-auto px-6 pb-6">
        
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-2">🔐 Encryption Settings</h1>
          <p className="text-sm text-white/60">
            Manage your end-to-end encryption keys for secure messaging
          </p>
        </div>

        {/* Key Status */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Encryption Status</h2>
          
          {keyStatus === 'checking' && (
            <div className="flex items-center gap-3 text-white/60">
              <i className="fa-solid fa-spinner fa-spin" />
              <span>Checking encryption keys...</span>
            </div>
          )}

          {keyStatus === 'ready' && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-green-400">
                <i className="fa-solid fa-circle-check text-xl" />
                <span className="font-medium">Encryption Active</span>
              </div>
              
              {lastGenerated && (
                <div className="text-sm text-white/60">
                  Keys generated: {lastGenerated}
                </div>
              )}

              <div className="mt-4 p-4 bg-green-500/10 border border-green-500/20 rounded-xl">
                <p className="text-sm text-green-300">
                  ✓ Your messages are end-to-end encrypted
                </p>
                <p className="text-xs text-green-300/60 mt-1">
                  Only you and the recipient can read them
                </p>
              </div>
            </div>
          )}

          {keyStatus === 'needs_sync' && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-yellow-400">
                <i className="fa-solid fa-rotate text-xl" />
                <span className="font-medium">Sync Required</span>
              </div>
              
              <div className="mt-4 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-xl">
                <p className="text-sm text-yellow-300 mb-3">
                  <i className="fa-solid fa-mobile-alt mr-2" />
                  Encryption keys found from another device
                </p>
                <p className="text-xs text-yellow-300/80 mb-4">
                  Sync your keys to read encrypted messages on this device
                </p>
                <button
                  onClick={handleRestoreFromBackup}
                  className="w-full px-4 py-3 rounded-xl bg-yellow-500 hover:bg-yellow-600 text-black font-medium transition-all"
                >
                  <i className="fa-solid fa-key mr-2" />
                  Sync Encryption Keys
                </button>
              </div>
            </div>
          )}

          {keyStatus === 'none' && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-yellow-400">
                <i className="fa-solid fa-circle-exclamation text-xl" />
                <span className="font-medium">No Encryption Keys</span>
              </div>
              
              <div className="mt-4 p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-xl">
                <p className="text-sm text-yellow-300">
                  Encryption keys will be generated automatically when you send your next message
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Multi-Device Sync */}
        {keyStatus === 'ready' && (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 mb-6">
            <h2 className="text-lg font-semibold mb-2">
              <i className="fa-solid fa-mobile-alt mr-2" />
              Multi-Device Sync
            </h2>
            <p className="text-sm text-white/60 mb-4">
              Sync your encryption keys across all your devices (iOS app, web, etc.)
            </p>

            {hasServerBackup ? (
              <div className="p-4 bg-green-500/10 border border-green-500/20 rounded-xl mb-4">
                <div className="flex items-center gap-2 text-green-400 mb-1">
                  <i className="fa-solid fa-cloud-check" />
                  <span className="font-medium text-sm">Backup Active</span>
                </div>
                <p className="text-xs text-green-300/60">
                  Your keys are backed up. New devices can sync using your backup password.
                </p>
              </div>
            ) : (
              <div className="p-4 bg-orange-500/10 border border-orange-500/20 rounded-xl mb-4">
                <div className="flex items-center gap-2 text-orange-400 mb-1">
                  <i className="fa-solid fa-triangle-exclamation" />
                  <span className="font-medium text-sm">No Backup</span>
                </div>
                <p className="text-xs text-orange-300/60">
                  Create a backup to sync encryption on other devices.
                </p>
              </div>
            )}

            <button
              onClick={handleCreateBackup}
              className="w-full px-4 py-3 rounded-xl bg-[#4db6ac] hover:bg-[#3da99e] text-white font-medium transition-all"
            >
              <i className="fa-solid fa-cloud-arrow-up mr-2" />
              {hasServerBackup ? 'Update Backup' : 'Create Backup'}
            </button>
          </div>
        )}

        {/* Reset Keys */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
          <h2 className="text-lg font-semibold mb-2">Reset Encryption Keys</h2>
          <p className="text-sm text-white/60 mb-4">
            If you're having issues with encrypted messages, you can reset your keys. This will generate fresh encryption keys.
          </p>

          <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-xl mb-4">
            <p className="text-sm text-yellow-300 mb-2">
              <i className="fa-solid fa-triangle-exclamation mr-2" />
              Warning
            </p>
            <ul className="text-xs text-yellow-300/80 space-y-1 ml-5 list-disc">
              <li>Old encrypted messages may become unreadable</li>
              <li>Other users will automatically fetch your new public key</li>
            </ul>
          </div>

          <button
            onClick={resetEncryptionKeys}
            className="w-full px-6 py-3 rounded-xl font-medium transition-all bg-red-600 hover:bg-red-700 text-white active:scale-95"
          >
            <i className="fa-solid fa-rotate-right mr-2" />
            Reset Encryption Keys
          </button>
        </div>

        {/* Info Section */}
        <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl">
          <h3 className="text-sm font-semibold text-blue-300 mb-2">
            <i className="fa-solid fa-circle-info mr-2" />
            How End-to-End Encryption Works
          </h3>
          <ul className="text-xs text-blue-300/80 space-y-1 ml-5 list-disc">
            <li>Messages are encrypted on your device before being sent</li>
            <li>Only the recipient can decrypt them with their private key</li>
            <li>The server cannot read your encrypted messages</li>
            <li>Each user has their own encryption keys stored locally</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
