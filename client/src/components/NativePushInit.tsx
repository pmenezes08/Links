import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { FCMNotifications } from '../services/fcmNotifications';

export default function NativePushInit() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      console.log('Not a native platform, skipping FCM');
      return;
    }

    console.log('🔥 NativePushInit: Starting FCM registration...');

    const registerFCM = async () => {
      try {
        // Try to get FCM token (with retry)
        let token = await FCMNotifications.getToken();
        
        // If no token yet, retry after 2 seconds
        if (!token) {
          console.log('⏳ No token yet, retrying in 2s...');
          await new Promise(resolve => setTimeout(resolve, 2000));
          token = await FCMNotifications.getToken();
        }
        
        if (token) {
          console.log('🔥 FCM Token received:', token.substring(0, 20) + '...');
          
          // Register token with your server
          const response = await fetch('/api/push/register_fcm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              token: token,
              platform: 'ios'
            })
          });
          
          const result = await response.json();
          
          if (response.ok) {
            console.log('✅ FCM token registered with server:', result);
          } else {
            console.error('❌ FCM registration failed:', result);
          }
        } else {
          console.warn('❌ Could not get FCM token after retry');
        }
      } catch (error) {
        console.error('❌ FCM registration error:', error);
      }
    };

    // Start registration
    registerFCM();

    // Also listen for token refreshes
    const handleTokenRefresh = (event: any) => {
      if (event && event.token) {
        console.log('🔥 FCM Token refreshed:', event.token.substring(0, 20) + '...');
        registerFCM();
      }
    };

    window.addEventListener('FCMTokenRefresh', handleTokenRefresh);

    return () => {
      window.removeEventListener('FCMTokenRefresh', handleTokenRefresh);
    };
  }, []);

  return null;
}
