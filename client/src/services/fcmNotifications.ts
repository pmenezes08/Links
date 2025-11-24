import { registerPlugin } from '@capacitor/core';

export interface FCMPluginInterface {
  getToken(): Promise<{ token: string | null }>;
  deleteToken(): Promise<void>;
  addListener(
    eventName: 'tokenReceived',
    listenerFunc: (data: { token: string }) => void
  ): Promise<any>;
  removeAllListeners(): Promise<void>;
}

const FCMPlugin = registerPlugin<FCMPluginInterface>('FCMPlugin', {
  web: () => ({
    async getToken() {
      return { token: null };
    },
    async deleteToken() {},
    async addListener() {
      return { remove: () => {} };
    },
    async removeAllListeners() {}
  })
});

export const FCMNotifications = {
  /**
   * Get the current FCM token from Firebase
   */
  async getToken(): Promise<string | null> {
    try {
      console.log('🔥 FCMNotifications: Requesting token...');
      const result = await FCMPlugin.getToken();
      
      if (result.token) {
        console.log('✅ FCM token received:', result.token.substring(0, 20) + '...');
        return result.token;
      } else {
        console.warn('⚠️  No FCM token available yet');
        return null;
      }
    } catch (error) {
      console.error('❌ Error getting FCM token:', error);
      return null;
    }
  },

  /**
   * Listen for FCM token updates
   */
  addTokenListener(callback: (token: string) => void) {
    console.log('🔥 FCMNotifications: Adding token listener');
    return FCMPlugin.addListener('tokenReceived', (data) => {
      console.log('🔥 Token received via listener:', data.token.substring(0, 20) + '...');
      callback(data.token);
    });
  },

  /**
   * Delete the current FCM token
   */
  async deleteToken(): Promise<void> {
    try {
      await FCMPlugin.deleteToken();
      console.log('✅ FCM token deleted');
    } catch (error) {
      console.error('❌ Error deleting FCM token:', error);
      throw error;
    }
  }
};
