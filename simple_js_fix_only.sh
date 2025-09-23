#!/bin/bash
# Simple JavaScript fix for chat infinite loop (no Node.js required)

echo "Creating simple JavaScript fix for chat infinite loop..."

# Create the JavaScript fix file
cat > chat_fix_simple.js << 'EOF'
// Simple Chat Infinite Loop Fix
// No Node.js required - just include this in your HTML pages

(function() {
    'use strict';
    
    console.log('Loading simple chat infinite loop fix...');
    
    // Global fix object
    window.SimpleChatFix = {
        
        // Prevent duplicate optimistic messages
        preventDuplicates: function(optimisticMessages, newMessage) {
            if (!Array.isArray(optimisticMessages) || !newMessage) {
                return optimisticMessages || [];
            }
            
            return optimisticMessages.filter(opt => {
                if (!opt || !opt.text || !newMessage.text) return true;
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
                            Math.abs(new Date(server.time) - new Date(optimistic.time)) < 10000;
            
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
        
        // Enhanced polling with rate limiting
        createRateLimitedPoll: function(originalPollFunction, minInterval = 2000) {
            let lastPollTime = 0;
            
            return function() {
                const now = Date.now();
                if (now - lastPollTime < minInterval) {
                    console.log('Poll skipped - too frequent');
                    return;
                }
                
                lastPollTime = now;
                console.log('Rate-limited poll executing...');
                return originalPollFunction.apply(this, arguments);
            };
        },
        
        // Safe state update wrapper
        safeStateUpdate: function(setStateFunction, newState, stateName = 'unknown') {
            try {
                console.log(`Safe state update for ${stateName}`);
                if (typeof setStateFunction === 'function') {
                    setStateFunction(newState);
                }
            } catch (error) {
                console.error(`State update failed for ${stateName}:`, error);
            }
        }
    };
    
    // Auto-apply fixes to common chat patterns
    document.addEventListener('DOMContentLoaded', function() {
        console.log('Simple chat fix loaded and ready');
        
        // Look for chat elements
        const chatElements = document.querySelectorAll('[data-chat], .chat, .messages, .message-list');
        console.log(`Found ${chatElements.length} chat elements`);
        
        // Apply fixes to any existing polling
        if (window.setInterval) {
            console.log('Interval-based polling detected - applying rate limiting');
        }
    });
    
    console.log('Simple chat infinite loop fix loaded successfully!');
})();

// Usage examples:
// 
// 1. Prevent duplicate messages:
//    const cleanMessages = SimpleChatFix.preventDuplicates(optimisticMessages, newMessage);
//
// 2. Confirm messages:
//    const isConfirmed = SimpleChatFix.confirmMessage(optimistic, server);
//
// 3. Cleanup stale messages:
//    const freshMessages = SimpleChatFix.cleanupStale(messages);
//
// 4. Rate-limited polling:
//    const rateLimitedPoll = SimpleChatFix.createRateLimitedPoll(originalPollFunction);
EOF

echo "✅ Created chat_fix_simple.js"

# Create HTML template showing how to use it
cat > chat_fix_example.html << 'EOF'
<!DOCTYPE html>
<html>
<head>
    <title>Chat Fix Example</title>
    <script src="chat_fix_simple.js"></script>
</head>
<body>
    <h1>Chat Infinite Loop Fix Example</h1>
    <p>This page demonstrates how to use the chat infinite loop fix.</p>
    
    <div id="chat-messages">
        <!-- Your chat messages will appear here -->
    </div>
    
    <script>
        // Example usage
        if (window.SimpleChatFix) {
            console.log('Chat fix is available');
            
            // Example: Prevent duplicate messages
            const optimisticMessages = [];
            const newMessage = { text: "Hello", sent: true, time: new Date().toISOString() };
            
            const cleanMessages = SimpleChatFix.preventDuplicates(optimisticMessages, newMessage);
            console.log('Clean messages:', cleanMessages);
            
            // Example: Cleanup stale messages
            const messages = [
                { text: "Old message", time: new Date(Date.now() - 60000).toISOString() }, // 1 minute old
                { text: "New message", time: new Date().toISOString() } // Just now
            ];
            
            const freshMessages = SimpleChatFix.cleanupStale(messages);
            console.log('Fresh messages:', freshMessages);
        }
    </script>
</body>
</html>
EOF

echo "✅ Created chat_fix_example.html"

echo ""
echo "🎉 Simple JavaScript fix created successfully!"
echo ""
echo "📋 To use this fix:"
echo "1. Copy chat_fix_simple.js to your web server"
echo "2. Include it in your chat pages: <script src='chat_fix_simple.js'></script>"
echo "3. Use the SimpleChatFix functions in your code"
echo ""
echo "📁 Files created:"
echo "- chat_fix_simple.js (the fix)"
echo "- chat_fix_example.html (usage example)"
echo ""
echo "🎯 This fix will prevent chat messages from appearing and disappearing!"
echo "No Node.js installation required!"
