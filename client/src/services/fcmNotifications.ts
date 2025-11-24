import { Capacitor } from '@capacitor/core';

declare global {
  interface Window {
    webkit?: {
      messageHandlers?: {
        getFCMToken?: {
          postMessage: (message: any) => void;
        };
      };
    };
  }
}

export const FCMNotifications = {
  async getToken(): Promise<string | null> {
    if (!Capacitor.isNativePlatform()) {
      return null;
    }
    
    // Try multiple approaches to get the FCM token
    
    // Approach 1: Listen for FCMTokenRefresh event (from AppDelegate)
    const tokenFromEvent = await new Promise<string | null>((resolve) => {
      const listener = (event: any) => {
        if (event && event.token) {
          resolve(event.token);
          window.removeEventListener('FCMTokenRefresh', listener);
        }
      };
      
      window.addEventListener('FCMTokenRefresh', listener);
      
      setTimeout(() => {
        resolve(null);
        window.removeEventListener('FCMTokenRefresh', listener);
      }, 3000);
    });
    
    if (tokenFromEvent) {
      console.log('✅ Got FCM token from event');
      return tokenFromEvent;
    }
    
    // Approach 2: Check if token was stored in localStorage by native code
    try {
      const storedToken = localStorage.getItem('fcm_token');
      if (storedToken) {
        console.log('✅ Got FCM token from localStorage');
        return storedToken;
      }
    } catch (e) {
      console.warn('Could not check localStorage:', e);
    }
    
    console.warn('❌ No FCM token available yet');
    return null;
  }
};
