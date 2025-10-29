#!/bin/bash
# Start Flask with OpenAI API key

echo "=================================================="
echo "Flask Startup with OpenAI Integration"
echo "=================================================="
echo ""

# Check if API key is set
if [ -z "$OPENAI_API_KEY" ]; then
    echo "❌ ERROR: OPENAI_API_KEY not set!"
    echo ""
    echo "Please run this command first:"
    echo "export OPENAI_API_KEY='sk-proj-YOUR-KEY-HERE'"
    echo ""
    echo "Or set it and run this script:"
    echo "OPENAI_API_KEY='sk-proj-YOUR-KEY-HERE' ./start_with_openai.sh"
    exit 1
fi

echo "✅ OPENAI_API_KEY is set (${#OPENAI_API_KEY} characters)"
echo ""

# Verify OpenAI package is installed
if ! python3 -c "import openai" 2>/dev/null; then
    echo "⚠️  OpenAI package not installed, installing now..."
    pip install openai
    echo ""
fi

echo "✅ OpenAI package installed"
echo ""

# Test OpenAI connection
echo "Testing OpenAI API connection..."
python3 -c "
from openai import OpenAI
import os
try:
    client = OpenAI(api_key=os.environ['OPENAI_API_KEY'])
    print('✅ OpenAI client initialized successfully')
except Exception as e:
    print(f'❌ Error: {e}')
    exit(1)
"

if [ $? -eq 0 ]; then
    echo ""
    echo "=================================================="
    echo "🚀 Starting Flask with AI transcription enabled"
    echo "=================================================="
    echo ""
    python3 bodybuilding_app.py
else
    echo ""
    echo "❌ OpenAI connection test failed. Please check your API key."
    exit 1
fi
