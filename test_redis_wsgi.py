#!/usr/bin/env python3
"""
Test if Redis is configured correctly via environment variables
Run this on PythonAnywhere to diagnose issues
"""

import os
import sys

print("=" * 60)
print("Redis Configuration Test")
print("=" * 60)

# Check environment variables
print("\n1️⃣ Environment Variables:")
env_vars = {
    'REDIS_ENABLED': os.environ.get('REDIS_ENABLED', 'NOT SET'),
    'REDIS_HOST': os.environ.get('REDIS_HOST', 'NOT SET'),
    'REDIS_PORT': os.environ.get('REDIS_PORT', 'NOT SET'),
    'REDIS_USERNAME': os.environ.get('REDIS_USERNAME', 'NOT SET'),
    'REDIS_PASSWORD': 'SET' if os.environ.get('REDIS_PASSWORD') else 'NOT SET',
}

all_set = True
for key, value in env_vars.items():
    status = "✅" if value not in ['NOT SET', ''] else "❌"
    print(f"   {status} {key}: {value}")
    if value in ['NOT SET', '']:
        all_set = False

if not all_set:
    print("\n❌ NOT ALL ENVIRONMENT VARIABLES ARE SET!")
    print("\nAdd these to your WSGI file at the TOP:")
    print("""
import os
os.environ['REDIS_ENABLED'] = 'true'
os.environ['REDIS_HOST'] = 'redis-12834.c275.us-east-1-4.ec2.cloud.redislabs.com'
os.environ['REDIS_PORT'] = '12834'
os.environ['REDIS_USERNAME'] = 'default'
os.environ['REDIS_PASSWORD'] = '9wrV3MjrTnIC9uTcaEqrAvrW2fOsqdxV'
    """)
    sys.exit(1)

print("\n✅ All environment variables are set!")

# Check redis package
print("\n2️⃣ Redis Package:")
try:
    import redis
    print(f"   ✅ redis package installed (version: {redis.__version__})")
except ImportError:
    print("   ❌ redis package NOT installed!")
    print("   Run: pip install redis==5.0.1 --user")
    sys.exit(1)

# Check project path
print("\n3️⃣ Project Path:")
project_paths = [
    '/home/puntz08/WorkoutX/Links',
    '/home/puntz08/Links',
    '/home/puntz08/WorkoutX',
]

found_path = None
for path in project_paths:
    if os.path.exists(path):
        bodybuilding_path = os.path.join(path, 'bodybuilding_app.py')
        redis_cache_path = os.path.join(path, 'redis_cache.py')
        if os.path.exists(bodybuilding_path) and os.path.exists(redis_cache_path):
            found_path = path
            print(f"   ✅ Found project at: {path}")
            break

if not found_path:
    print("   ❌ Could not find project directory!")
    print("   Checked:")
    for path in project_paths:
        print(f"      - {path}")
    sys.exit(1)

sys.path.insert(0, found_path)

# Test importing redis_cache
print("\n4️⃣ Import redis_cache module:")
try:
    from redis_cache import cache, REDIS_ENABLED, REDIS_AVAILABLE
    print(f"   ✅ redis_cache imported successfully")
    print(f"   REDIS_AVAILABLE: {REDIS_AVAILABLE}")
    print(f"   REDIS_ENABLED: {REDIS_ENABLED}")
    print(f"   Cache type: {type(cache).__name__}")
    print(f"   Cache enabled: {cache.enabled}")
except Exception as e:
    print(f"   ❌ Failed to import redis_cache: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

# Test Redis connection
print("\n5️⃣ Redis Connection:")
if hasattr(cache, 'redis_client') and cache.redis_client:
    try:
        cache.redis_client.ping()
        print("   ✅ Redis PING successful!")
        
        # Get info
        info = cache.redis_client.info()
        print(f"   Redis version: {info.get('redis_version', 'unknown')}")
        print(f"   Connected clients: {info.get('connected_clients', 0)}")
        print(f"   Used memory: {info.get('used_memory_human', '0B')}")
        
        # Test set/get
        test_key = 'wsgi_test_key'
        test_value = 'Hello from WSGI test!'
        cache.set(test_key, test_value, ttl=10)
        retrieved = cache.get(test_key)
        
        if retrieved == test_value:
            print(f"   ✅ Set/Get test passed!")
        else:
            print(f"   ❌ Set/Get test failed (got: {retrieved})")
        
        # Cleanup
        cache.delete(test_key)
        
    except Exception as e:
        print(f"   ❌ Redis connection error: {e}")
        import traceback
        traceback.print_exc()
else:
    print("   ❌ Redis client not initialized!")
    print("   Using in-memory cache instead")

print("\n" + "=" * 60)
if hasattr(cache, 'redis_client') and cache.redis_client:
    print("🎉 SUCCESS! Redis is configured correctly!")
    print("\nYour web app should now be using Redis.")
    print("Reload your web app to apply changes.")
else:
    print("❌ FAILED! Redis is NOT working!")
    print("\nCheck the errors above and fix them.")
print("=" * 60)
