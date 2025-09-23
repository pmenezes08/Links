#!/bin/bash
# Build React app with chat infinite loop fixes

echo "Building React app with chat fixes..."

# Navigate to client directory
cd client

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Build the app
echo "Building React app..."
npm run build

if [ $? -eq 0 ]; then
    echo "React app built successfully!"
    echo "Built files are in client/dist/"
    echo ""
    echo "To deploy:"
    echo "1. Copy client/dist/* to your web server"
    echo "2. Or run: cp -r client/dist/* /path/to/your/web/server/"
    echo ""
    echo "Chat infinite loop issue should be fixed!"
else
    echo "Build failed!"
    exit 1
fi
