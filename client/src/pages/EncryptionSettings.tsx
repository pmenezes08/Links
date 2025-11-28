import { useState, useEffect } from 'react'
import { useHeader } from '../contexts/HeaderContext'
import { encryptionService } from '../services/simpleEncryption'
import { keychainStorage } from '../services/keychainStorage'

export default function EncryptionSettings() {
  const { setTitle } = useHeader()
  const [keyStatus, setKeyStatus] = useState<'checking' | 'ready' | 'none'>('checking')
  const [lastGenerated, setLastGenerated] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)

  useEffect(() => {
    setTitle('Encryption Settings')
    checkKeyStatus()
  }, [setTitle])

  async function checkKeyStatus() {
    try {
      // Check if encryption database exists
      const dbs = await indexedDB.databases()
      const encryptionDb = dbs.find(db => db.name === 'chat-encryption')
      
      if (encryptionDb) {
        setKeyStatus('ready')
        // Try to get timestamp from localStorage
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

  async function resetEncryptionKeys() {
    if (!confirm('Reset your encryption keys?\n\nThis will:\n- Delete your current encryption keys\n- Generate fresh new keys\n- Allow you to send/receive encrypted messages again\n\nNote: Old encrypted messages may become unreadable.')) {
      return
    }

    setResetting(true)

    try {
      console.log('🔐 Starting encryption key reset...')
      
      // 1. Close the database connection first
      encryptionService.closeDatabase()
      console.log('🔐 Database connection closed')
      
      // 2. Delete the IndexedDB database
      await new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase('chat-encryption')
        request.onsuccess = () => {
          console.log('🔐 ✅ Old encryption database deleted')
          resolve()
        }
        request.onerror = () => {
          console.log('🔐 ⚠️ Database deletion error (may not exist)')
          resolve()
        }
        request.onblocked = () => {
          console.log('🔐 ⚠️ Database deletion blocked')
          resolve()
        }
      })
      
      // 3. Clear keys from Keychain storage
      const username = localStorage.getItem('username') || ''
      if (username) {
        try {
          await keychainStorage.removeKeys(username)
          console.log('🔐 ✅ Keychain keys cleared')
        } catch (e) {
          console.log('🔐 ⚠️ Keychain clear error:', e)
        }
      }
      
      // 4. Update timestamp
      localStorage.setItem('encryption_keys_generated_at', Date.now().toString())
      
      // 5. Re-initialize encryption (this will generate new keys)
      if (username) {
        console.log('🔐 Generating new encryption keys...')
        await encryptionService.init(username)
        console.log('🔐 ✅ New encryption keys generated!')
      }
      
      // 6. Update UI state
      setKeyStatus('ready')
      const date = new Date()
      setLastGenerated(date.toLocaleString())
      setResetting(false)
      setShowSuccess(true)
      
      // Auto-hide success message after 5 seconds
      setTimeout(() => setShowSuccess(false), 5000)
      
    } catch (error) {
      console.error('🔐 ❌ Error resetting keys:', error)
      alert('Failed to reset encryption keys. Please try again.')
      setResetting(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-[#1a2f2a] to-gray-900 text-white pb-20">
      {/* Success Popup */}
      {showSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-gray-900 border border-green-500/30 rounded-2xl p-6 max-w-sm w-full shadow-2xl animate-in fade-in zoom-in duration-200">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/20 flex items-center justify-center">
                <i className="fa-solid fa-check text-3xl text-green-400" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Keys Reset Successfully!</h3>
              <p className="text-sm text-white/60 mb-4">
                Your encryption keys have been regenerated. You can now send and receive encrypted messages.
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

      <div className="max-w-2xl mx-auto px-6 pb-6">
        
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
            disabled={resetting}
            className={`w-full px-6 py-3 rounded-xl font-medium transition-all ${
              resetting
                ? 'bg-gray-600 text-gray-300 cursor-not-allowed'
                : 'bg-red-600 hover:bg-red-700 text-white active:scale-95'
            }`}
          >
            {resetting ? (
              <>
                <i className="fa-solid fa-spinner fa-spin mr-2" />
                Resetting Keys...
              </>
            ) : (
              <>
                <i className="fa-solid fa-rotate-right mr-2" />
                Reset Encryption Keys
              </>
            )}
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
