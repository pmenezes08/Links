/**
 * @deprecated Prefer PushInit (App.tsx). Kept in sync with its register_fcm payload;
 * not mounted in the current app shell.
 */
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';

export default function NativePushInit() {
  const navigate = useNavigate();

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
            platform: Capacitor.getPlatform(),
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

    // Handle navigation based on notification URL
    const handleNotificationNavigation = (url: string | undefined) => {
      if (!url) {
        console.log('📍 No URL in notification, going to notifications page');
        navigate('/notifications');
        return;
      }

      console.log('📍 Navigating to:', url);

      // Message notifications: /user_chat/chat/{username} - navigate directly
      if (url.startsWith('/user_chat/chat/')) {
        navigate(url);
        return;
      }

      // Profile URLs: /profile/{username}
      if (url.startsWith('/profile/')) {
        navigate(url);
        return;
      }

      // Event URLs: /event/{id} or /community/{id}/calendar
      if (url.startsWith('/event/') || url.includes('/calendar')) {
        // Convert to React routes if needed
        const reactUrl = url.replace('/calendar', '/calendar_react');
        navigate(reactUrl);
        return;
      }

      // Poll URLs: /community/{id}/polls_react
      if (url.includes('/polls')) {
        const reactUrl = url.includes('_react') ? url : url.replace('/polls', '/polls_react');
        navigate(reactUrl);
        return;
      }

      // Community feed: /community_feed/{id}
      if (url.startsWith('/community_feed/')) {
        const id = url.replace('/community_feed/', '');
        navigate(`/community_feed_react/${id}`);
        return;
      }

      // Post detail: /post/{id}
      if (url.startsWith('/post/')) {
        navigate(url);
        return;
      }

      // Followers/requests
      if (url.startsWith('/followers')) {
        navigate(url);
        return;
      }

      // Default: try to navigate to the URL directly
      navigate(url);
    };

    // Clear badge when app starts (in case there are stale badges)
    const clearBadgeOnStart = async () => {
      try {
        // Remove all delivered notifications - this should also clear badge on iOS
        await PushNotifications.removeAllDeliveredNotifications();
        console.log('✅ Cleared delivered notifications on start');
        
        // Also tell server to sync badge via silent push
        console.log('📛 Calling /api/notifications/clear-badge on startup...');
        const resp = await fetch('/api/notifications/clear-badge', { method: 'POST', credentials: 'include' });
        const result = await resp.json();
        console.log('📛 Clear badge response:', result);
        
        // Retry after delays to ensure badge updates
        setTimeout(async () => {
          try {
            await PushNotifications.removeAllDeliveredNotifications();
            await fetch('/api/notifications/clear-badge', { method: 'POST', credentials: 'include' });
            console.log('📛 Badge retry 1 complete');
          } catch {}
        }, 1000);
        
        setTimeout(async () => {
          try {
            await fetch('/api/notifications/clear-badge', { method: 'POST', credentials: 'include' });
            console.log('📛 Badge retry 2 complete');
          } catch {}
        }, 3000);
      } catch (e) {
        console.warn('Could not clear badge on start:', e);
      }
    };

    const initializePushNotifications = async () => {
      try {
        // Clear any stale badges first
        await clearBadgeOnStart();
        
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

        // Step 5: Listen for notifications received while app is in foreground
        await PushNotifications.addListener('pushNotificationReceived', (notification) => {
          console.log('📬 Push notification received:', notification);
          // Could show an in-app toast/banner here if desired
        });

        // Step 6: Listen for notification taps - NAVIGATE TO RELEVANT PAGE
        await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
          console.log('👆 Push notification tapped:', JSON.stringify(action, null, 2));
          
          // Extract URL from notification data
          // The data can be in different places depending on iOS/Android and FCM/APNs
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const notification: any = action.notification || {};
          const data = notification.data || {};
          
          // Try multiple possible locations for the URL
          const url = data.url 
            || data.link 
            || data.deepLink
            || notification.url  // Sometimes at root level
            || notification.link
            || notification.custom?.url  // FCM custom data
            || notification.userInfo?.url;  // APNs userInfo
          
          console.log('📍 Full notification object:', JSON.stringify(notification, null, 2));
          console.log('📍 Data object:', JSON.stringify(data, null, 2));
          console.log('📍 Extracted URL:', url);
          
          // Navigate to the relevant page
          handleNotificationNavigation(url);
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
  }, [navigate]);

  return null;
}
