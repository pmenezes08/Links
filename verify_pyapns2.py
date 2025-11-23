#!/usr/bin/env python3
"""
Verify PyAPNs2 installation and discover correct import path
"""

import sys
import os

print("=" * 60)
print("🔍 PyAPNs2 Installation Verification")
print("=" * 60)

print(f"\nPython: {sys.version}")
print(f"Executable: {sys.executable}")

# Check pip list for PyAPNs2
print("\n1️⃣  Checking pip list for PyAPNs2...")
import subprocess
try:
    result = subprocess.run([sys.executable, '-m', 'pip', 'list'], 
                          capture_output=True, text=True, timeout=10)
    lines = [line for line in result.stdout.split('\n') if 'apns' in line.lower()]
    if lines:
        print("   Found packages:")
        for line in lines:
            print(f"   {line}")
    else:
        print("   ❌ No APNs packages found in pip list")
except Exception as e:
    print(f"   Error checking pip: {e}")

# Try different import variations
print("\n2️⃣  Testing import variations...")

imports_to_try = [
    ('apns2', 'from apns2.client import APNsClient'),
    ('pyapns2', 'from pyapns2.client import APNsClient'),
    ('PyAPNs2', 'from PyAPNs2.client import APNsClient'),
]

working_import = None

for module_name, import_statement in imports_to_try:
    try:
        exec(import_statement)
        print(f"   ✅ Working import: {import_statement}")
        working_import = import_statement
        
        # Try to get module info
        module = __import__(module_name)
        print(f"      Location: {module.__file__}")
        if hasattr(module, '__version__'):
            print(f"      Version: {module.__version__}")
        break
    except ImportError as e:
        print(f"   ❌ Failed: {import_statement}")
        print(f"      Error: {e}")
    except Exception as e:
        print(f"   ❌ Error: {e}")

# If we found a working import, test the components
if working_import:
    print("\n3️⃣  Testing APNs components...")
    try:
        # Extract the module name from the import
        module_name = import_statement.split()[1].split('.')[0]
        
        # Try importing all necessary components
        exec(f"from {module_name}.client import APNsClient")
        print(f"   ✅ APNsClient available from {module_name}")
        
        exec(f"from {module_name}.credentials import TokenCredentials")
        print(f"   ✅ TokenCredentials available from {module_name}")
        
        exec(f"from {module_name}.payload import Payload")
        print(f"   ✅ Payload available from {module_name}")
        
        print(f"\n✅ SUCCESS! Use this import in your code:")
        print(f"   from {module_name}.client import APNsClient")
        print(f"   from {module_name}.credentials import TokenCredentials")
        print(f"   from {module_name}.payload import Payload")
        
    except Exception as e:
        print(f"   ❌ Error importing components: {e}")
else:
    print("\n❌ No working import found!")
    print("\nTroubleshooting:")
    print("1. Verify installation: pip show PyAPNs2")
    print("2. Try reinstalling: pip uninstall PyAPNs2 -y && pip install PyAPNs2 --user")
    print("3. Check if installed in different Python: which python3")

print("\n" + "=" * 60)
