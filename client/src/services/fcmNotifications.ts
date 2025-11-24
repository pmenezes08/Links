import { Capacitor } from '@capacitor/core';

export const FCMNotifications = {
  async getToken(): Promise<string | null> {
    if (!Capacitor.isNativePlatform()) {
      return null;
    }
    
    return new Promise((resolve) => {
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
      }, 5000);
    });
  }
};
