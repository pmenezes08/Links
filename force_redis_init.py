#!/usr/bin/env python3
"""
Force Redis initialization check - add to top of bodybuilding_app.py
"""

import os
import sys

# Print to ensure we can see startup
print("=" * 60, flush=True)
print("🚀 Application Starting...", flush=True)
print(f"   Python version: {sys.version}", flush=True)
print(f"   REDIS_ENABLED env: {os.environ.get('REDIS_ENABLED', 'NOT SET')}", flush=True)
print(f"   REDIS_HOST env: {os.environ.get('REDIS_HOST', 'NOT SET')}", flush=True)
print("=" * 60, flush=True)

# Now when redis_cache is imported, we'll see its messages
try:
    from redis_cache import cache, REDIS_ENABLED, REDIS_AVAILABLE
    print(f"✅ redis_cache imported successfully", flush=True)
    print(f"   REDIS_ENABLED: {REDIS_ENABLED}", flush=True)
    print(f"   REDIS_AVAILABLE: {REDIS_AVAILABLE}", flush=True)
    print(f"   Cache type: {type(cache).__name__}", flush=True)
    print(f"   Cache enabled: {cache.enabled}", flush=True)
    
    if hasattr(cache, 'redis_client') and cache.redis_client:
        try:
            cache.redis_client.ping()
            print("   ✅ Redis PING successful!", flush=True)
        except Exception as e:
            print(f"   ❌ Redis PING failed: {e}", flush=True)
    else:
        print("   ⚠️  Using in-memory cache", flush=True)
        
except Exception as e:
    print(f"❌ Failed to import redis_cache: {e}", flush=True)
    import traceback
    traceback.print_exc()

print("=" * 60, flush=True)
