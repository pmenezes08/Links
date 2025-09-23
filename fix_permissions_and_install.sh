#!/bin/bash
# Fix permissions and install Node.js on PythonAnywhere

echo "Fixing permissions and installing Node.js..."

# Make scripts executable
chmod +x install_nodejs_and_build.sh
chmod +x simple_build_fix.sh
chmod +x build_chat_fix.sh

echo "Permissions fixed!"

# Check if we can run the installation
echo "Attempting to install Node.js..."

# Try the installation script
./install_nodejs_and_build.sh
