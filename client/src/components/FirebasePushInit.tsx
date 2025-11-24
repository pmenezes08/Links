import { useEffect, useState } from 'react';
import { requestNotificationPermission, onMessageListener } from '../services/firebase';

export default function FirebasePushInit() {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const initializeFirebase = async () => {
      try {
        // Request notification permission and get FCM token
        const fcmToken = await requestNotificationPermission();
        if (fcmToken) {
          setToken(fcmToken);
          console.log('FCM token obtained:', fcmToken);

          // Register token with backend
          await registerTokenWithBackend(fcmToken);

          // Store token locally
          localStorage.setItem('fcmToken', fcmToken);
        } else {
          console.log('No FCM token obtained');
        }
      } catch (error) {
        console.error('Error initializing Firebase:', error);
      }
    };

    // Only initialize on mobile devices or when explicitly enabled
    const isMobile = /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const isCapacitor = !!(window as any).Capacitor;

    if (isMobile || isCapacitor) {
      initializeFirebase();
    }

    // Listen for messages when app is in foreground
    onMessageListener().then((payload: any) => {
      console.log('Message received in foreground:', payload);

      // Handle foreground messages (show in-app notification, etc.)
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistration().then((registration) => {
          if (registration) {
            registration.showNotification(
              payload.notification?.title || 'New Notification',
              {
                body: payload.notification?.body || '',
                icon: '/icons/icon-192.png',
                badge: '/icons/icon-192.png',
                data: payload.data || {},
                tag: payload.data?.tag || 'default'
              }
            );
          }
        });
      }
    }).catch((error) => {
      console.error('Error setting up message listener:', error);
    });

  }, []);

  const registerTokenWithBackend = async (fcmToken: string) => {
    try {
      const response = await fetch('/api/fcm/register_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          fcm_token: fcmToken,
          platform: 'ios' // or detect platform
        })
      });

      const result = await response.json();
      if (result.success) {
        console.log('FCM token registered successfully');
      } else {
        console.error('Failed to register FCM token:', result.error);
      }
    } catch (error) {
      console.error('Error registering FCM token:', error);
    }
  };

  return null; // This component doesn't render anything
}