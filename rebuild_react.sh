s #!/bin/bash
# Rebuild React Frontend Script
# This script rebuilds the React app so changes take effect

echo "🔧 Rebuilding React Frontend..."
echo "================================"

# Check if we're in the right directory
if [ ! -f "client/package.json" ]; then
    echo "❌ Error: client/package.json not found!"
    echo "Make sure you're running this from the project root directory."
    exit 1
fi

# Navigate to client directory
cd client

echo "📦 Installing/updating dependencies..."
# Try different npm paths for PythonAnywhere compatibility
if command -v npm >/dev/null 2>&1; then
    npm install
elif [ -f "/home/ubuntu/.nvm/versions/node/v22.16.0/bin/npm" ]; then
    /home/ubuntu/.nvm/versions/node/v22.16.0/bin/npm install
else
    echo "⚠️  npm not found in PATH, trying alternative approaches..."
    # Try to source nvm
    if [ -f "$HOME/.nvm/nvm.sh" ]; then
        source "$HOME/.nvm/nvm.sh"
        npm install
    else
        echo "❌ Could not find npm. Please install Node.js/npm."
        exit 1
    fi
fi

echo "🏗️  Building React app..."
if command -v npm >/dev/null 2>&1; then
    npm run build
elif [ -f "/home/ubuntu/.nvm/versions/node/v22.16.0/bin/npm" ]; then
    /home/ubuntu/.nvm/versions/node/v22.16.0/bin/npm run build
else
    if [ -f "$HOME/.nvm/nvm.sh" ]; then
        source "$HOME/.nvm/nvm.sh"
        npm run build
    else
        echo "❌ Could not find npm for build."
        exit 1
    fi
fi

# Check if build was successful
if [ $? -eq 0 ]; then
    echo "✅ React build successful!"
    echo ""
    echo "📁 Built files are in client/dist/"
    echo "Flask app will now serve the updated React components."
    echo ""
    echo "🚀 Next steps:"
    echo "1. Restart your Flask application"
    echo "2. Clear browser cache (Ctrl+F5 or Cmd+Shift+R)"
    echo "3. Test the updated user chat interface"
    echo ""
    echo "🎉 Your React changes should now be visible!"
else
    echo "❌ Build failed!"
    echo "Check the error messages above and fix any issues."
    exit 1
fi