#!/bin/bash
# Fix MuseTalk PyYAML dependency issue

echo "=== Fixing MuseTalk PyYAML Dependency ==="

# Install PyYAML in multiple ways to ensure it's found
echo "1. Installing PyYAML with pip3 (user)..."
pip3 install --user PyYAML

echo "2. Installing PyYAML with python3 -m pip (user)..."
python3 -m pip install --user PyYAML

echo "3. Installing PyYAML without --user flag..."
pip3 install PyYAML 2>/dev/null || echo "  (Skipped - no permission)"

echo ""
echo "4. Checking MuseTalk requirements..."
if [ -f "MuseTalk/requirements.txt" ]; then
    echo "  Installing MuseTalk requirements..."
    pip3 install --user -r MuseTalk/requirements.txt
else
    echo "  No MuseTalk requirements.txt found"
fi

echo ""
echo "5. Verifying PyYAML installation..."
python3 -c "import yaml; print('✅ PyYAML', yaml.__version__, 'at', yaml.__file__)"

echo ""
echo "=== Fix Complete ==="
echo "Now restart your Flask app:"
echo "  pkill -f bodybuilding_app.py"
echo "  python3 bodybuilding_app.py"
