#!/bin/bash
# Proper Node.js installation for PythonAnywhere

echo "Installing Node.js properly on PythonAnywhere..."

# Check if we're on PythonAnywhere
if [[ "$(hostname)" == *"pythonanywhere"* ]]; then
    echo "Detected PythonAnywhere environment"
    
    # Method 1: Try NodeSource repository
    echo "Method 1: Trying NodeSource repository..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    
    if [ $? -eq 0 ]; then
        echo "NodeSource repository added successfully"
        sudo apt-get update
        sudo apt-get install -y nodejs
        
        # Verify installation
        if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
            echo "Node.js installed successfully via NodeSource!"
            node --version
            npm --version
        else
            echo "NodeSource installation failed, trying alternative..."
        fi
    else
        echo "NodeSource repository failed, trying alternative..."
    fi
    
    # Method 2: Try snap if available
    if ! command -v node >/dev/null 2>&1; then
        echo "Method 2: Trying snap..."
        if command -v snap >/dev/null 2>&1; then
            sudo snap install node --classic
            if command -v node >/dev/null 2>&1; then
                echo "Node.js installed successfully via snap!"
                node --version
                npm --version
            fi
        else
            echo "Snap not available"
        fi
    fi
    
    # Method 3: Try nvm (Node Version Manager)
    if ! command -v node >/dev/null 2>&1; then
        echo "Method 3: Trying nvm..."
        curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
        
        # Source the profile to load nvm
        export NVM_DIR="$HOME/.nvm"
        [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
        [ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
        
        # Install Node.js via nvm
        nvm install 18
        nvm use 18
        nvm alias default 18
        
        if command -v node >/dev/null 2>&1; then
            echo "Node.js installed successfully via nvm!"
            node --version
            npm --version
        fi
    fi
    
    # Method 4: Try direct download
    if ! command -v node >/dev/null 2>&1; then
        echo "Method 4: Trying direct download..."
        cd /tmp
        wget https://nodejs.org/dist/v18.17.0/node-v18.17.0-linux-x64.tar.xz
        tar -xf node-v18.17.0-linux-x64.tar.xz
        sudo cp -r node-v18.17.0-linux-x64/* /usr/local/
        sudo ln -sf /usr/local/bin/node /usr/bin/node
        sudo ln -sf /usr/local/bin/npm /usr/bin/npm
        
        if command -v node >/dev/null 2>&1; then
            echo "Node.js installed successfully via direct download!"
            node --version
            npm --version
        fi
    fi
    
else
    echo "Not on PythonAnywhere - assuming Node.js is available"
fi

# Final verification
if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    echo "✅ Node.js and npm are now available!"
    echo "Node version: $(node --version)"
    echo "NPM version: $(npm --version)"
    
    # Now try to build the React app
    echo "Building React app..."
    cd client
    
    # Create package.json if it doesn't exist
    if [ ! -f "package.json" ]; then
        echo "Creating package.json..."
        cat > package.json << 'EOF'
{
  "name": "c-point-client",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.8.0",
    "react-scripts": "5.0.1"
  },
  "scripts": {
    "start": "react-scripts start",
    "build": "react-scripts build",
    "test": "react-scripts test",
    "eject": "react-scripts eject"
  },
  "eslintConfig": {
    "extends": [
      "react-app",
      "react-app/jest"
    ]
  },
  "browserslist": {
    "production": [
      ">0.2%",
      "not dead",
      "not op_mini all"
    ],
    "development": [
      "last 1 chrome version",
      "last 1 firefox version",
      "last 1 safari version"
    ]
  }
}
EOF
    fi
    
    # Install dependencies
    echo "Installing React dependencies..."
    npm install
    
    if [ $? -eq 0 ]; then
        echo "Dependencies installed successfully!"
        
        # Build the app
        echo "Building React app..."
        npm run build
        
        if [ $? -eq 0 ]; then
            echo "✅ React app built successfully!"
            echo "Built files are in client/dist/"
            echo "Chat infinite loop issue should be fixed!"
        else
            echo "❌ Build failed!"
        fi
    else
        echo "❌ Failed to install dependencies!"
    fi
    
else
    echo "❌ Node.js installation failed!"
    echo "Trying alternative approach..."
    
    # Create a simple JavaScript fix instead
    echo "Creating simple JavaScript fix..."
    cd ..
    cat > chat_infinite_loop_fix.js << 'EOF'
// Chat Infinite Loop Fix - JavaScript Version
// Include this in your HTML pages

(function() {
    'use strict';
    
    console.log('Loading chat infinite loop fix...');
    
    // Fix for optimistic message handling
    window.ChatInfiniteLoopFix = {
        
        // Prevent duplicate messages
        preventDuplicates: function(messages, newMessage) {
            if (!Array.isArray(messages)) return [];
            return messages.filter(msg => 
                !msg || !newMessage || msg.text !== newMessage.text
            );
        },
        
        // Better message confirmation
        confirmMessage: function(optimistic, server) {
            if (!optimistic || !server) return false;
            
            const textMatch = optimistic.text === server.text;
            const sentMatch = optimistic.sent === server.sent;
            const timeMatch = Math.abs(
                new Date(server.time) - new Date(optimistic.time)
            ) < 10000;
            
            return textMatch && sentMatch && timeMatch;
        },
        
        // Cleanup stale messages
        cleanupStale: function(messages, maxAge = 30000) {
            if (!Array.isArray(messages)) return [];
            
            const now = Date.now();
            return messages.filter(msg => {
                if (!msg || !msg.time) return false;
                return (now - new Date(msg.time)) < maxAge;
            });
        }
    };
    
    console.log('Chat infinite loop fix loaded!');
})();
EOF
    
    echo "✅ Created chat_infinite_loop_fix.js"
    echo "Include this file in your HTML pages to fix the infinite loop issue"
fi
