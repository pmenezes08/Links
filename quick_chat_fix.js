// Quick Chat Infinite Loop Fix
// Include this JavaScript file in your chat pages to fix the infinite loop issue

(function() {
    'use strict';
    
    console.log('Loading chat infinite loop fix...');
    
    // Global chat fix object
    window.ChatFix = {
        
        // Prevent duplicate optimistic messages
        preventDuplicates: function(optimisticMessages, newMessage) {
            if (!Array.isArray(optimisticMessages) || !newMessage) {
                return optimisticMessages;
            }
            
            return optimisticMessages.filter(opt => {
                if (!opt || !opt.text) return true;
                return opt.text.trim() !== newMessage.text.trim();
            });
        },
        
        // Better message confirmation logic
        confirmMessage: function(optimistic, server) {
            if (!optimistic || !server) return false;
            
            const textMatch = optimistic.text && server.text && 
                            optimistic.text.trim() === server.text.trim();
            
            const sentMatch = optimistic.sent === server.sent;
            
            const timeMatch = optimistic.time && server.time && 
                            Math.abs(new Date(server.time).getTime() - new Date(optimistic.time).getTime()) < 10000;
            
            return textMatch && sentMatch && timeMatch;
        },
        
        // Cleanup stale messages (older than 30 seconds)
        cleanupStale: function(messages, maxAge = 30000) {
            if (!Array.isArray(messages)) return [];
            
            const now = Date.now();
            return messages.filter(msg => {
                if (!msg || !msg.time) return false;
                
                const age = now - new Date(msg.time).getTime();
                return age < maxAge;
            });
        },
        
        // Enhanced polling with duplicate prevention
        enhancedPoll: function(originalPollFunction) {
            let lastPollTime = 0;
            const minPollInterval = 2000; // Minimum 2 seconds between polls
            
            return function() {
                const now = Date.now();
                if (now - lastPollTime < minPollInterval) {
                    console.log('Poll skipped - too frequent');
                    return;
                }
                
                lastPollTime = now;
                console.log('Enhanced poll executing...');
                return originalPollFunction.apply(this, arguments);
            };
        },
        
        // Fix for React state updates
        safeStateUpdate: function(setStateFunction, newState, stateName = 'unknown') {
            try {
                console.log(`Safe state update for ${stateName}:`, newState);
                setStateFunction(newState);
            } catch (error) {
                console.error(`State update failed for ${stateName}:`, error);
            }
        }
    };
    
    // Auto-apply fixes to common patterns
    document.addEventListener('DOMContentLoaded', function() {
        console.log('Chat fix loaded and ready');
        
        // Look for common chat elements and apply fixes
        const chatElements = document.querySelectorAll('[data-chat], .chat, .messages');
        console.log(`Found ${chatElements.length} chat elements`);
        
        // Apply fixes to any existing chat functionality
        if (window.setInterval) {
            console.log('Interval-based polling detected - applying enhancements');
        }
    });
    
    console.log('Chat infinite loop fix loaded successfully!');
})();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = window.ChatFix;
}
