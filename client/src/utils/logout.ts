/**
 * Proper logout utility that clears all client-side state before navigating to /logout
 */

export async function performLogout(): Promise<void> {
  console.log('🚪 Starting logout process...')
  
  // 1. Stop any polling intervals
  try {
    if ((window as any).__header_poll) {
      delete (window as any).__header_poll
    }
    if ((window as any).__header_do_poll) {
      delete (window as any).__header_do_poll
    }
  } catch (e) {
    console.warn('Error clearing polling:', e)
  }

  // 2. Clear localStorage items related to the session
  const keysToRemove = [
    'signal_device_id',
    'current_username',
    'encryption_keys_generated_at',
    'encryption_needs_sync',
    'encryption_reset_requested',
    'last_community_id',
    'mic_permission_granted',
    'home-timeline',
    'communityManagementShowNested',
  ]
  
  // Also clear any keys that start with these prefixes
  const prefixesToClear = [
    'signal_',
    'chat_',
    'community_',
    'cpoint_',
    'onboarding_',
    'signal-store-',
  ]
  
  try {
    // Remove known keys
    keysToRemove.forEach(key => {
      try { localStorage.removeItem(key) } catch {}
    })
    
    // Remove keys by prefix
    const allKeys = Object.keys(localStorage)
    allKeys.forEach(key => {
      if (prefixesToClear.some(prefix => key.startsWith(prefix))) {
        try { localStorage.removeItem(key) } catch {}
      }
    })
    console.log('✅ localStorage cleared')
  } catch (e) {
    console.warn('Error clearing localStorage:', e)
  }

  // 3. Clear sessionStorage
  try {
    sessionStorage.clear()
    console.log('✅ sessionStorage cleared')
  } catch (e) {
    console.warn('Error clearing sessionStorage:', e)
  }

  // 4. Clear IndexedDB databases (encryption, signal protocol)
  const dbsToDelete = [
    'chat-encryption',
    'signal-protocol',
    'signal-store',
  ]
  
  for (const dbName of dbsToDelete) {
    try {
      await new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase(dbName)
        request.onsuccess = () => {
          console.log(`✅ Deleted IndexedDB: ${dbName}`)
          resolve()
        }
        request.onerror = () => {
          console.warn(`⚠️ Could not delete IndexedDB: ${dbName}`)
          resolve()
        }
        request.onblocked = () => {
          console.warn(`⚠️ IndexedDB deletion blocked: ${dbName}`)
          resolve()
        }
        // Timeout after 1 second
        setTimeout(resolve, 1000)
      })
    } catch (e) {
      console.warn(`Error deleting IndexedDB ${dbName}:`, e)
    }
  }

  // 5. Clear any cached data in memory by reloading the page after logout
  console.log('🚪 Navigating to /logout endpoint...')
  
  // Navigate to logout endpoint - use replace to prevent back button issues
  window.location.replace('/logout')
}

/**
 * Logout button component props
 */
export function handleLogoutClick(e: React.MouseEvent): void {
  e.preventDefault()
  performLogout()
}
