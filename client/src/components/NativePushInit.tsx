import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';

export default function NativePushInit() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      console.log('Not a native platform, skipping push notifications');
      return;
    }

    console.log('🔥 NativePushInit: Starting push notification registration...');

    const registerToken = async (token: string) => {
      try {
        console.log('📤 Registering FCM token with server...');
        console.log('   Token preview:', token.substring(0, 30) + '...');
        
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
          console.error('❌ FCM registration failed:', response.status, result);
        }
      } catch (error) {
        console.error('❌ Error registering token:', error);
      }
    };

    const initializePushNotifications = async () => {
      try {
        // Step 1: Request permissions
        console.log('📋 Requesting push notification permissions...');
        const permResult = await PushNotifications.requestPermissions();
        
        if (permResult.receive === 'granted') {
          console.log('✅ Push notification permissions granted');
          
          // Step 2: Register with APNs (Firebase will convert to FCM token)
          await PushNotifications.register();
          console.log('📱 Registered for push notifications');
        } else {
          console.warn('⚠️  Push notification permissions denied');
          return;
        }

        // Step 3: Listen for registration success
        await PushNotifications.addListener('registration', (token) => {
          console.log('🔥 Push token received:', token.value.substring(0, 30) + '...');
          registerToken(token.value);
        });

        // Step 4: Listen for registration errors
        await PushNotifications.addListener('registrationError', (error) => {
          console.error('❌ Push registration error:', error);
        });

        // Step 5: Listen for notifications received
        await PushNotifications.addListener('pushNotificationReceived', (notification) => {
          console.log('📬 Push notification received:', notification);
        });

        // Step 6: Listen for notification actions
        await PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
          console.log('👆 Push notification action:', notification);
        });

        console.log('✅ Push notification listeners registered');

      } catch (error) {
        console.error('❌ Push notification initialization error:', error);
      }
    };

    initializePushNotifications();

    // Cleanup
    return () => {
      PushNotifications.removeAllListeners();
    };
  }, []);

  return null;
}
