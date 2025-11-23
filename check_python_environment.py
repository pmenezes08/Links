#!/usr/bin/env python3
"""
Check which Python environment the web app is using
"""

import sys
import os

print("=" * 60)
print("🔍 Python Environment Check")
print("=" * 60)

print(f"\n1. Python Version: {sys.version}")
print(f"\n2. Python Executable: {sys.executable}")
print(f"\n3. Python Path:")
for path in sys.path:
    print(f"   - {path}")

print(f"\n4. Site Packages:")
try:
    import site
    print(f"   User site: {site.USER_SITE}")
    print(f"   Site packages: {site.getsitepackages()}")
except:
    pass

print("\n5. Checking apns2:")
try:
    import apns2
    print(f"   ✅ apns2 found at: {apns2.__file__}")
    print(f"   Version: {apns2.__version__ if hasattr(apns2, '__version__') else 'Unknown'}")
except ImportError as e:
    print(f"   ❌ apns2 NOT found")
    print(f"   Error: {e}")

print("\n6. Checking apns2 components:")
try:
    from apns2.client import APNsClient
    from apns2.credentials import TokenCredentials
    from apns2.payload import Payload
    print("   ✅ APNsClient available")
    print("   ✅ TokenCredentials available")
    print("   ✅ Payload available")
except ImportError as e:
    print(f"   ❌ Import error: {e}")

print("\n7. Environment Variables:")
apns_vars = ['APNS_KEY_PATH', 'APNS_KEY_ID', 'APNS_TEAM_ID', 'APNS_BUNDLE_ID', 'APNS_USE_SANDBOX']
for var in apns_vars:
    value = os.getenv(var)
    if value:
        if 'KEY_PATH' in var:
            exists = "✅ EXISTS" if os.path.exists(value) else "❌ NOT FOUND"
            print(f"   {var}: {value} ({exists})")
        else:
            print(f"   {var}: {value}")
    else:
        print(f"   {var}: ❌ NOT SET")

print("\n" + "=" * 60)
