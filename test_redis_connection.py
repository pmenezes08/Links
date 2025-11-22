#!/usr/bin/env python3
"""
Test Redis Cloud Connection
Run this to verify your Redis connection works
"""

import sys

def test_redis_connection():
    """Test connection to Redis Cloud"""
    
    print("🔌 Testing Redis Cloud Connection...")
    print("=" * 60)
    
    # Try to import redis
    try:
        import redis
        print("✅ redis package is installed")
    except ImportError:
        print("❌ redis package not installed!")
        print("\n📦 Install with:")
        print("   pip install redis==5.0.1 --user")
        return False
    
    # Connection details
    config = {
        'host': 'redis-12834.c275.us-east-1-4.ec2.cloud.redislabs.com',
        'port': 12834,
        'decode_responses': True,
        'username': 'default',
        'password': '9wrV3MjrTnIC9uTcaEqrAvrW2fOsqdxV',
    }
    
    print(f"\n🌐 Connection Details:")
    print(f"   Host: {config['host']}")
    print(f"   Port: {config['port']}")
    print(f"   Username: {config['username']}")
    print(f"   Password: {'*' * len(config['password'])}")
    
    try:
        # Create Redis connection
        print("\n🔗 Connecting to Redis Cloud...")
        r = redis.Redis(**config)
        
        # Test ping
        print("   Testing PING...", end=" ")
        r.ping()
        print("✅ PONG received!")
        
        # Test set/get
        print("   Testing SET/GET...", end=" ")
        test_key = 'connection_test_key'
        test_value = 'Hello from C.Point!'
        r.set(test_key, test_value)
        result = r.get(test_key)
        
        if result == test_value:
            print(f"✅ Success!")
        else:
            print(f"❌ Failed (got: {result})")
            return False
        
        # Test performance
        print("\n⚡ Performance Test:")
        import time
        
        # Write test
        print("   Writing 100 keys...", end=" ")
        start = time.time()
        for i in range(100):
            r.set(f'perf_test_{i}', f'value_{i}')
        write_time = (time.time() - start) * 1000
        print(f"{write_time:.1f}ms")
        
        # Read test
        print("   Reading 100 keys...", end=" ")
        start = time.time()
        hits = 0
        for i in range(100):
            if r.get(f'perf_test_{i}'):
                hits += 1
        read_time = (time.time() - start) * 1000
        print(f"{read_time:.1f}ms (hit rate: {hits}%)")
        
        # Cleanup
        print("   Cleaning up test keys...", end=" ")
        r.delete(test_key)
        for i in range(100):
            r.delete(f'perf_test_{i}')
        print("✅")
        
        # Get Redis info
        print("\n📊 Redis Server Info:")
        info = r.info()
        print(f"   Redis version: {info.get('redis_version', 'unknown')}")
        print(f"   Connected clients: {info.get('connected_clients', 0)}")
        print(f"   Used memory: {info.get('used_memory_human', '0B')}")
        print(f"   Total keys: {info.get('db0', {}).get('keys', 0) if 'db0' in info else 0}")
        
        # Performance assessment
        print("\n✨ Performance Assessment:")
        if read_time < 50:
            print("   🚀 EXCELLENT - Very fast connection (< 50ms)")
        elif read_time < 100:
            print("   ⚡ GOOD - Fast connection (< 100ms)")
        elif read_time < 200:
            print("   ✅ OK - Acceptable connection (< 200ms)")
        else:
            print("   ⚠️  SLOW - Connection is slower than expected")
            print("      Check if Redis Cloud and PythonAnywhere are in same region")
        
        print("\n" + "=" * 60)
        print("🎉 Redis Cloud is working perfectly!")
        print("\n📝 Next Steps:")
        print("   1. Set environment variables on PythonAnywhere:")
        print("      REDIS_ENABLED=true")
        print(f"      REDIS_HOST={config['host']}")
        print(f"      REDIS_PORT={config['port']}")
        print(f"      REDIS_USERNAME={config['username']}")
        print(f"      REDIS_PASSWORD={config['password']}")
        print("\n   2. Reload your web app")
        print("\n   3. Your app will be 5-20x faster! 🚀")
        
        return True
        
    except redis.ConnectionError as e:
        print(f"\n❌ Connection Error: {e}")
        print("\n💡 Troubleshooting:")
        print("   1. Check if Redis Cloud database is active")
        print("   2. Verify username and password are correct")
        print("   3. Check firewall/IP restrictions in Redis Cloud dashboard")
        print("   4. Ensure internet connection is working")
        return False
        
    except redis.AuthenticationError as e:
        print(f"\n❌ Authentication Error: {e}")
        print("\n💡 Check:")
        print("   - Username is correct (usually 'default')")
        print("   - Password matches Redis Cloud dashboard")
        return False
        
    except Exception as e:
        print(f"\n❌ Unexpected Error: {e}")
        print(f"   Error type: {type(e).__name__}")
        return False

if __name__ == '__main__':
    success = test_redis_connection()
    sys.exit(0 if success else 1)
