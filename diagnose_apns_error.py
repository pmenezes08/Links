#!/usr/bin/env python3.10
"""
Diagnostic script to find why APNs is still failing.
Run this on Cloud Run: python3.10 diagnose_apns_error.py
"""

import sys
import os

print("="*60)
print("🔍 APNs Error Diagnostic")
print("="*60)

# Check 1: Python version
print(f"\n1️⃣ Python version: {sys.version}")

# Check 2: httpx availability
print("\n2️⃣ Checking httpx...")
try:
    import httpx
    print(f"   ✅ httpx installed: {httpx.__version__}")
except ImportError as e:
    print(f"   ❌ httpx NOT installed: {e}")
    print("   FIX: pip3.10 install --user 'httpx[http2]>=0.24.0'")

# Check 3: PyJWT availability
print("\n3️⃣ Checking PyJWT...")
try:
    import jwt
    print(f"   ✅ PyJWT installed: {jwt.__version__}")
except ImportError as e:
    print(f"   ❌ PyJWT NOT installed: {e}")
    print("   FIX: pip3.10 install --user 'PyJWT>=2.8.0'")

# Check 4: cryptography
print("\n4️⃣ Checking cryptography...")
try:
    import cryptography
    from cryptography.hazmat.primitives import serialization
    print(f"   ✅ cryptography installed: {cryptography.__version__}")
except ImportError as e:
    print(f"   ❌ cryptography NOT installed: {e}")

# Check 5: Old apns2 library
print("\n5️⃣ Checking for OLD apns2 library...")
try:
    import apns2
    print(f"   ⚠️  OLD apns2 library FOUND at: {apns2.__file__}")
    print("   This should NOT be installed!")
    print("   FIX: pip3.10 uninstall apns2 -y")
except ImportError:
    print("   ✅ apns2 NOT installed (correct!)")

# Check 6: PyAPNs2 library
print("\n6️⃣ Checking for PyAPNs2 library...")
try:
    import sys
    # Try different import names
    for name in ['PyAPNs2', 'pyapns2']:
        if name in sys.modules:
            print(f"   ⚠️  {name} found in sys.modules")
    
    # Try importing
    try:
        __import__('PyAPNs2')
        print("   ⚠️  PyAPNs2 library installed (not needed)")
        print("   FIX: pip3.10 uninstall PyAPNs2 -y")
    except ImportError:
        pass
        
    print("   ✅ PyAPNs2 NOT installed (correct!)")
except Exception as e:
    print(f"   Error checking: {e}")

# Check 7: Can we import our notification module?
print("\n7️⃣ Testing backend.services.notifications import...")
sys.path.insert(0, '/home/puntz08/workspace')
try:
    from backend.services.notifications import APNS_AVAILABLE, send_apns_notification
    print(f"   ✅ Module imported successfully")
    print(f"   APNS_AVAILABLE = {APNS_AVAILABLE}")
    
    if not APNS_AVAILABLE:
        print("   ❌ APNS_AVAILABLE is False!")
        print("   This means httpx, jwt, or cryptography failed to import")
except Exception as e:
    print(f"   ❌ Import failed: {e}")
    import traceback
    traceback.print_exc()

# Check 8: Test JWT generation
print("\n8️⃣ Testing JWT token generation...")
if os.path.exists('/home/puntz08/secrets/AuthKey_X2X7S84MLF.p8'):
    try:
        import jwt
        import time
        from cryptography.hazmat.primitives import serialization
        
        with open('/home/puntz08/secrets/AuthKey_X2X7S84MLF.p8', 'rb') as f:
            private_key = serialization.load_pem_private_key(
                f.read(),
                password=None
            )
        
        payload = {
            "iss": "SP6N8UL583",
            "iat": int(time.time())
        }
        headers = {
            "alg": "ES256",
            "kid": "X2X7S84MLF"
        }
        
        token = jwt.encode(payload, private_key, algorithm="ES256", headers=headers)
        print(f"   ✅ JWT token generated successfully!")
        print(f"   Token preview: {token[:50]}...")
        
    except Exception as e:
        print(f"   ❌ JWT generation failed: {e}")
        import traceback
        traceback.print_exc()
else:
    print("   ⚠️  .p8 key file not found at /home/puntz08/secrets/AuthKey_X2X7S84MLF.p8")

# Check 9: Look for .pyc cache files
print("\n9️⃣ Checking for cached bytecode...")
import glob
pyc_files = glob.glob('/home/puntz08/workspace/backend/**/__pycache__/*.pyc', recursive=True)
if pyc_files:
    print(f"   Found {len(pyc_files)} .pyc files")
    print("   FIX: find /home/puntz08/workspace -type d -name __pycache__ -exec rm -rf {{}} + 2>/dev/null")
else:
    print("   ✅ No .pyc cache found")

print("\n" + "="*60)
print("📊 SUMMARY")
print("="*60)

# Determine the issue
issues = []
fixes = []

try:
    import httpx
except ImportError:
    issues.append("❌ httpx not installed")
    fixes.append("pip3.10 install --user 'httpx[http2]>=0.24.0'")

try:
    import jwt
except ImportError:
    issues.append("❌ PyJWT not installed")
    fixes.append("pip3.10 install --user 'PyJWT>=2.8.0'")

try:
    import apns2
    issues.append("❌ OLD apns2 library still installed")
    fixes.append("pip3.10 uninstall apns2 -y")
except ImportError:
    pass

if issues:
    print("\n🚨 ISSUES FOUND:")
    for issue in issues:
        print(f"   {issue}")
    print("\n🔧 RUN THESE COMMANDS:")
    for fix in fixes:
        print(f"   {fix}")
    print("\nThen reload your web app!")
else:
    print("\n✅ All dependencies look good!")
    print("\nIf error persists:")
    print("1. Clear cache: find . -type d -name __pycache__ -exec rm -rf {} +")
    print("2. Reload web app on Cloud Run")
    print("3. Check if you're using the correct WSGI file")

print("="*60)
