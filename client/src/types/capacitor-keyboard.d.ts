// Type declaration for @capacitor/keyboard
// This ensures builds succeed even if the package isn't fully installed

declare module '@capacitor/keyboard' {
  export interface KeyboardInfo {
    keyboardHeight: number
  }

  export interface KeyboardPlugin {
    addListener(
      eventName: 'keyboardWillShow',
      listenerFunc: (info: KeyboardInfo) => void
    ): Promise<{ remove: () => void }>
    
    addListener(
      eventName: 'keyboardWillHide',
      listenerFunc: () => void
    ): Promise<{ remove: () => void }>
    
    addListener(
      eventName: 'keyboardDidShow',
      listenerFunc: (info: KeyboardInfo) => void
    ): Promise<{ remove: () => void }>
    
    addListener(
      eventName: 'keyboardDidHide',
      listenerFunc: () => void
    ): Promise<{ remove: () => void }>
  }

  export const Keyboard: KeyboardPlugin
}
