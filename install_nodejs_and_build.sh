#!/bin/bash
# Install Node.js and npm, then build React app with chat fixes

echo "Installing Node.js and npm on PythonAnywhere..."

# Check if we're on PythonAnywhere
if [[ "$(hostname)" == *"pythonanywhere"* ]]; then
    echo "Detected PythonAnywhere environment"
    
    # Install Node.js using NodeSource repository
    echo "Adding NodeSource repository..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
    
    echo "Installing Node.js..."
    sudo apt-get install -y nodejs
    
    # Verify installation
    echo "Verifying Node.js installation..."
    node --version
    npm --version
    
    if [ $? -eq 0 ]; then
        echo "Node.js and npm installed successfully!"
    else
        echo "Node.js installation failed!"
        exit 1
    fi
else
    echo "Not on PythonAnywhere - assuming Node.js is available"
fi

# Navigate to client directory
echo "Navigating to client directory..."
cd client

# Check if package.json exists
if [ ! -f "package.json" ]; then
    echo "package.json not found! Creating basic React setup..."
    
    # Create package.json
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
    
    echo "Created package.json"
fi

# Install dependencies
echo "Installing React dependencies..."
npm install

if [ $? -eq 0 ]; then
    echo "Dependencies installed successfully!"
else
    echo "Failed to install dependencies!"
    exit 1
fi

# Build the app
echo "Building React app with chat fixes..."
npm run build

if [ $? -eq 0 ]; then
    echo "React app built successfully!"
    echo "Built files are in client/dist/"
    echo ""
    echo "Chat infinite loop issue should be fixed!"
    echo ""
    echo "To deploy:"
    echo "1. Copy client/dist/* to your web server"
    echo "2. Or run: cp -r client/dist/* /path/to/your/web/server/"
else
    echo "Build failed!"
    exit 1
fi
