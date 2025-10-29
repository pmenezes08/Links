#!/bin/bash

# Setup OpenAI API Key for C-Point App
# Run this script with: bash setup_openai_key.sh YOUR_OPENAI_API_KEY

if [ -z "$1" ]; then
    echo "❌ Error: Please provide your OpenAI API key"
    echo ""
    echo "Usage:"
    echo "  bash setup_openai_key.sh sk-your-actual-key-here"
    echo ""
    echo "Get your API key from: https://platform.openai.com/api-keys"
    exit 1
fi

API_KEY="$1"
echo "🔑 Setting up OpenAI API Key..."

# Add to .bashrc if not already present
if grep -q "OPENAI_API_KEY" ~/.bashrc; then
    echo "⚠️  OPENAI_API_KEY already exists in ~/.bashrc"
    echo "   Updating existing entry..."
    sed -i "/export OPENAI_API_KEY=/c\export OPENAI_API_KEY=\"$API_KEY\"" ~/.bashrc
else
    echo "✅ Adding OPENAI_API_KEY to ~/.bashrc"
    echo "" >> ~/.bashrc
    echo "# OpenAI API Key for AI audio transcription" >> ~/.bashrc
    echo "export OPENAI_API_KEY=\"$API_KEY\"" >> ~/.bashrc
fi

# Also add to .bash_profile for compatibility
if [ -f ~/.bash_profile ]; then
    if grep -q "OPENAI_API_KEY" ~/.bash_profile; then
        sed -i "/export OPENAI_API_KEY=/c\export OPENAI_API_KEY=\"$API_KEY\"" ~/.bash_profile
    else
        echo "" >> ~/.bash_profile
        echo "# OpenAI API Key for AI audio transcription" >> ~/.bash_profile
        echo "export OPENAI_API_KEY=\"$API_KEY\"" >> ~/.bash_profile
    fi
fi

# Set for current session
export OPENAI_API_KEY="$API_KEY"

echo ""
echo "✅ OpenAI API Key configured!"
echo ""
echo "Next steps:"
echo "1. Verify it's set: echo \$OPENAI_API_KEY"
echo "2. Restart your Flask app to load the key"
echo "3. If on PythonAnywhere, also add it via Web tab > Environment variables"
echo ""
echo "Testing audio transcription..."
python3 -c "
import os
try:
    from openai import OpenAI
    key = os.environ.get('OPENAI_API_KEY', '')
    if key:
        print('✅ OpenAI module imported successfully')
        print('✅ API key loaded (length: {} chars)'.format(len(key)))
    else:
        print('❌ API key not found in environment')
except ImportError:
    print('⚠️  OpenAI module not installed. Run: pip install openai==1.12.0')
"
