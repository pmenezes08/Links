#!/bin/bash
# Simple build fix for PythonAnywhere without Node.js installation

echo "Simple build fix for PythonAnywhere..."

# Check if we have the built files already
if [ -d "client/dist" ]; then
    echo "Found existing dist directory"
    ls -la client/dist/
else
    echo "No dist directory found"
fi

# Alternative: Create a simple HTML file with the fixes
echo "Creating simple HTML fix..."

# Create a simple fix for the chat infinite loop
cat > chat_fix.js << 'EOF'
// Chat infinite loop fix - JavaScript version
// This can be included in your HTML pages

(function() {
    'use strict';
    
    // Fix for optimistic message handling
    window.chatFix = {
        // Prevent duplicate optimistic messages
        preventDuplicates: function(optimisticMessages, newMessage) {
            return optimisticMessages.filter(opt => 
                opt.text.trim() !== newMessage.text.trim()
            );
        },
        
        // Better message confirmation logic
        confirmMessage: function(optimistic, server) {
            return optimistic.text.trim() === server.text.trim() &&
                   optimistic.sent === server.sent &&
                   Math.abs(new Date(server.time).getTime() - new Date(optimistic.time).getTime()) < 10000;
        },
        
        // Cleanup stale messages
        cleanupStale: function(messages, maxAge = 30000) {
            const now = Date.now();
            return messages.filter(msg => {
                const age = now - new Date(msg.time).getTime();
                return age < maxAge;
            });
        }
    };
    
    console.log('Chat infinite loop fix loaded');
})();
EOF

echo "Created chat_fix.js with JavaScript fixes"

# Create a simple HTML template with the fixes
cat > chat_fix_template.html << 'EOF'
<!DOCTYPE html>
<html>
<head>
    <title>Chat Fix Template</title>
    <script src="chat_fix.js"></script>
</head>
<body>
    <h1>Chat Infinite Loop Fix</h1>
    <p>Include chat_fix.js in your chat pages to prevent infinite loops.</p>
    
    <script>
        // Example usage
        if (window.chatFix) {
            console.log('Chat fix is available');
        }
    </script>
</body>
</html>
EOF

echo "Created chat_fix_template.html"

echo ""
echo "Simple fix files created:"
echo "- chat_fix.js (JavaScript fixes)"
echo "- chat_fix_template.html (example usage)"
echo ""
echo "To apply the fix:"
echo "1. Include chat_fix.js in your chat pages"
echo "2. Use the functions to prevent infinite loops"
echo ""
echo "For full React build, you'll need to install Node.js first."
