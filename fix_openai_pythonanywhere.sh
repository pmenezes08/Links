#!/bin/bash
# Fix OpenAI version compatibility issue on PythonAnywhere

echo "=================================================="
echo "Fixing OpenAI Package Compatibility"
echo "=================================================="
echo ""

echo "Uninstalling old OpenAI package..."
pip uninstall -y openai

echo ""
echo "Installing latest compatible OpenAI package..."
pip install --user --upgrade openai

echo ""
echo "Verifying installation..."
python3 check_openai_setup.py

echo ""
echo "=================================================="
echo "If successful, go to PythonAnywhere Web tab and"
echo "click the green 'Reload' button!"
echo "=================================================="
