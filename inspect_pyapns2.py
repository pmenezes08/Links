#!/usr/bin/env python3
"""
Deep inspection of PyAPNs2 installation
"""

import sys
import subprocess
import os

print("=" * 60)
print("🔬 Deep PyAPNs2 Investigation")
print("=" * 60)

# Get package info
print("\n1️⃣  Package Information:")
try:
    result = subprocess.run([sys.executable, '-m', 'pip', 'show', 'PyAPNs2'], 
                          capture_output=True, text=True, timeout=10)
    print(result.stdout)
    
    # Extract location
    for line in result.stdout.split('\n'):
        if line.startswith('Location:'):
            location = line.split(':', 1)[1].strip()
            print(f"\n2️⃣  Checking package location: {location}")
            
            # List what's actually there
            possible_paths = [
                os.path.join(location, 'pyapns2'),
                os.path.join(location, 'PyAPNs2'),
                os.path.join(location, 'apns2'),
            ]
            
            for path in possible_paths:
                if os.path.exists(path):
                    print(f"\n   ✅ Found: {path}")
                    try:
                        files = os.listdir(path)
                        print(f"   Contents ({len(files)} items):")
                        for f in sorted(files)[:20]:  # First 20 files
                            print(f"      - {f}")
                        if len(files) > 20:
                            print(f"      ... and {len(files) - 20} more")
                    except Exception as e:
                        print(f"   Error listing: {e}")
                else:
                    print(f"   ❌ Not found: {path}")
            
            # Check for .dist-info
            dist_info_path = os.path.join(location, 'PyAPNs2-2.0.0.dist-info')
            if os.path.exists(dist_info_path):
                print(f"\n3️⃣  Package metadata found: {dist_info_path}")
                record_file = os.path.join(dist_info_path, 'RECORD')
                if os.path.exists(record_file):
                    print("   Installed files:")
                    with open(record_file) as f:
                        lines = f.readlines()[:30]  # First 30 lines
                        for line in lines:
                            print(f"      {line.strip()}")
                        if len(f.readlines()) > 30:
                            print(f"      ... more files")
            
            break
            
except Exception as e:
    print(f"Error: {e}")

print("\n4️⃣  Trying to import directly by path:")
try:
    result = subprocess.run([sys.executable, '-m', 'pip', 'show', 'PyAPNs2'], 
                          capture_output=True, text=True, timeout=10)
    for line in result.stdout.split('\n'):
        if line.startswith('Location:'):
            location = line.split(':', 1)[1].strip()
            sys.path.insert(0, location)
            print(f"   Added to path: {location}")
            
            # Try imports
            for module in ['pyapns2', 'PyAPNs2', 'apns2']:
                try:
                    imported = __import__(module)
                    print(f"   ✅ Successfully imported: {module}")
                    print(f"      File: {imported.__file__}")
                    print(f"      Dir: {[x for x in dir(imported) if not x.startswith('_')][:10]}")
                except ImportError as e:
                    print(f"   ❌ {module}: {e}")
            break
except Exception as e:
    print(f"   Error: {e}")

print("\n5️⃣  Check if it's actually installed correctly:")
try:
    result = subprocess.run([sys.executable, '-m', 'pip', 'check'], 
                          capture_output=True, text=True, timeout=10)
    if result.stdout.strip():
        print("   Issues found:")
        print(result.stdout)
    else:
        print("   ✅ No dependency conflicts")
except Exception as e:
    print(f"   Error: {e}")

print("\n" + "=" * 60)
print("💡 Recommendation:")
print("   If package is broken, try uninstalling and using alternative:")
print("   pip uninstall PyAPNs2 -y")
print("   pip install apns2==0.7.2 --user")
print("   Note: Will need Python compatibility fix for 3.10")
print("=" * 60)
