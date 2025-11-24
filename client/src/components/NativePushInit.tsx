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

    const registerToken = async (token: string) => {
      try {
        console.log('📤 Registering token with server...');
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
      } catch (error) {
        console.error('❌ Error registering token:', error);
      }
    };

    const initializeFCM = async () => {
      try {
        // Step 1: Add listener for token updates
        const listener = await FCMNotifications.addTokenListener((token) => {
          console.log('🔥 Token update received:', token.substring(0, 20) + '...');
          registerToken(token);
        });

        // Step 2: Try to get current token
        let token = await FCMNotifications.getToken();
        
        // Step 3: Retry if no token yet (Firebase might still be initializing)
        if (!token) {
          console.log('⏳ No token yet, retrying in 3s...');
          await new Promise(resolve => setTimeout(resolve, 3000));
          token = await FCMNotifications.getToken();
        }
        
        // Step 4: Register if we have a token
        if (token) {
          await registerToken(token);
        } else {
          console.warn('⚠️  No FCM token available yet. Will register when token is received.');
        }

        // Cleanup
        return () => {
          listener.remove();
        };
      } catch (error) {
        console.error('❌ FCM initialization error:', error);
      }
    };

    const cleanup = initializeFCM();

    return () => {
      cleanup.then(fn => fn?.());
    };
  }, []);

  return null;
}
