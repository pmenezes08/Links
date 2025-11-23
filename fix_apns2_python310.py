#!/usr/bin/env python3
"""
Patch apns2 0.7.2 for Python 3.10+ compatibility
Fixes: cannot import name 'Iterable' from 'collections'
"""

import os
import sys
import site

def patch_apns2():
    """Patch apns2 to work with Python 3.10+"""
    
    print("=" * 60)
    print("🔧 Patching apns2 for Python 3.10 Compatibility")
    print("=" * 60)
    
    # Find apns2 installation
    print("\n1️⃣  Finding apns2 installation...")
    
    possible_paths = [
        os.path.expanduser('~/.local/lib/python3.10/site-packages/apns2'),
        os.path.join(site.USER_SITE, 'apns2'),
        '/usr/local/lib/python3.10/site-packages/apns2',
        '/usr/lib/python3.10/site-packages/apns2',
    ]
    
    apns2_path = None
    for path in possible_paths:
        if os.path.exists(path):
            apns2_path = path
            print(f"   ✅ Found apns2 at: {path}")
            break
    
    if not apns2_path:
        print("   ❌ apns2 not found in any standard location")
        print("\n   Install it first: pip install apns2==0.7.2 --user")
        return False
    
    # Patch client.py
    print("\n2️⃣  Patching client.py...")
    client_file = os.path.join(apns2_path, 'client.py')
    
    if not os.path.exists(client_file):
        print(f"   ❌ File not found: {client_file}")
        return False
    
    try:
        with open(client_file, 'r') as f:
            content = f.read()
        
        original_content = content
        
        # Fix the import
        if 'from collections import Iterable' in content:
            content = content.replace(
                'from collections import Iterable',
                'from collections.abc import Iterable'
            )
            print("   ✅ Fixed: collections.Iterable → collections.abc.Iterable")
        else:
            print("   ℹ️  Already patched or different version")
        
        # Write back if changed
        if content != original_content:
            with open(client_file, 'w') as f:
                f.write(content)
            print("   ✅ File updated successfully")
        else:
            print("   ℹ️  No changes needed")
        
    except PermissionError:
        print("   ❌ Permission denied. Try running with sudo or as correct user")
        return False
    except Exception as e:
        print(f"   ❌ Error: {e}")
        return False
    
    # Verify the fix
    print("\n3️⃣  Verifying fix...")
    try:
        # Clear any cached imports
        if 'apns2' in sys.modules:
            del sys.modules['apns2']
        if 'apns2.client' in sys.modules:
            del sys.modules['apns2.client']
        
        from apns2.client import APNsClient
        from apns2.credentials import TokenCredentials
        from apns2.payload import Payload
        
        print("   ✅ apns2 imports successfully!")
        print("   ✅ APNsClient available")
        print("   ✅ TokenCredentials available")
        print("   ✅ Payload available")
        
        print("\n" + "=" * 60)
        print("✅ SUCCESS! apns2 is now Python 3.10 compatible")
        print("=" * 60)
        print("\nYou can now run:")
        print("  python3 test_send_apns.py <username>")
        
        return True
        
    except ImportError as e:
        print(f"   ❌ Still failing: {e}")
        print("\n   The patch may not have worked. Try alternative:")
        print("   pip uninstall apns2 -y")
        print("   pip install git+https://github.com/Pr0Ger/PyAPNs2.git --user")
        return False

if __name__ == '__main__':
    success = patch_apns2()
    sys.exit(0 if success else 1)
