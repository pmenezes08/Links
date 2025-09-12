#!/bin/bash
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
npm install

echo "🏗️  Building React app..."
npm run build

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