import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { FCMNotifications } from '../services/fcmNotifications';

export default function NativePushInit() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    const registerFCM = async () => {
      try {
        // Get FCM token
        const token = await FCMNotifications.getToken();
        
        if (token) {
          console.log('🔥 FCM Token:', token);
          
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
          
          if (response.ok) {
            console.log('✅ FCM token registered with server');
          }
        }
      } catch (error) {
        console.error('FCM registration error:', error);
      }
    };

    registerFCM();
  }, []);

  return null;
}
