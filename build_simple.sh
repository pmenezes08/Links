#!/bin/bash
# Simple build script without Node.js complications

echo "Building chat fix..."

# Check if we have a working React setup
if command -v npm >/dev/null 2>&1; then
    echo "NPM found, building React app..."
    cd client
    npm install
    npm run build
    echo "React app built successfully!"
else
    echo "NPM not found, creating simple JavaScript fix instead..."
    
    # Create a simple fix file
    cat > chat_simple_fix.js << 'EOF'
// Simple Chat Fix - No Infinite Loops
(function() {
    console.log('Simple chat fix loaded');
    
    // Simple message deduplication
    window.simpleChatFix = {
        dedupeMessages: function(messages) {
            const seen = new Set();
            return messages.filter(msg => {
                const key = msg.text + msg.time;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        }
    };
})();
EOF
    
    echo "Created chat_simple_fix.js"
fi
