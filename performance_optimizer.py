#!/usr/bin/env python3
"""
C.Point Performance Optimizer
Applies caching and optimizations to improve app responsiveness
"""

import sys
import os

# Add current directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

def optimize_app():
    """Apply performance optimizations to the Flask app"""
    print("🚀 C.Point Performance Optimizer")
    print("=" * 50)
    
    # Check Redis availability
    try:
        import redis
        print("✅ Redis package installed")
        redis_available = True
    except ImportError:
        print("⚠️  Redis package not installed")
        print("   Install with: pip install redis==5.0.1")
        redis_available = False
    
    # Check cache configuration
    from redis_cache import cache, REDIS_ENABLED, CACHE_ENABLED
    
    print(f"\n📊 Current Cache Status:")
    print(f"   - Cache Enabled: {CACHE_ENABLED}")
    print(f"   - Redis Enabled: {REDIS_ENABLED}")
    print(f"   - Active Cache: {'Redis' if REDIS_ENABLED and cache.enabled else 'In-Memory'}")
    
    if hasattr(cache, 'redis_client') and cache.enabled:
        try:
            cache.redis_client.ping()
            print("   - Redis Status: ✅ Connected")
        except:
            print("   - Redis Status: ❌ Connection Failed")
    
    # Test cache performance
    print(f"\n⚡ Testing Cache Performance...")
    import time
    
    test_key = "perf_test_key"
    test_value = {"data": "test" * 100}
    
    # Write test
    start = time.time()
    for i in range(100):
        cache.set(f"{test_key}_{i}", test_value, ttl=60)
    write_time = (time.time() - start) * 1000
    
    # Read test
    start = time.time()
    hits = 0
    for i in range(100):
        result = cache.get(f"{test_key}_{i}")
        if result: hits += 1
    read_time = (time.time() - start) * 1000
    
    print(f"   - Write 100 items: {write_time:.1f}ms")
    print(f"   - Read 100 items: {read_time:.1f}ms")
    print(f"   - Cache Hit Rate: {hits}%")
    
    # Cleanup test keys
    for i in range(100):
        cache.delete(f"{test_key}_{i}")
    
    # Database optimization recommendations
    print(f"\n💾 Database Optimization Checklist:")
    
    try:
        from bodybuilding_app import get_db_connection, USE_MYSQL
        
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Check indices
            if USE_MYSQL:
                c.execute("SHOW INDEX FROM posts WHERE Key_name != 'PRIMARY'")
            else:
                c.execute("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='posts'")
            
            indices = c.fetchall()
            index_count = len(indices)
            
            print(f"   - Posts table indices: {index_count}")
            
            if index_count < 3:
                print("   ⚠️  Recommended: Add indices for better performance")
                print("      Run: CREATE INDEX idx_posts_community ON posts(community_id)")
                print("      Run: CREATE INDEX idx_posts_timestamp ON posts(timestamp)")
    except Exception as e:
        print(f"   ⚠️  Could not check database: {e}")
    
    # Frontend optimization recommendations
    print(f"\n🎨 Frontend Optimization Status:")
    
    client_path = os.path.join(os.path.dirname(__file__), 'client', 'dist')
    if os.path.exists(client_path):
        # Check bundle sizes
        assets_path = os.path.join(client_path, 'assets')
        if os.path.exists(assets_path):
            js_files = [f for f in os.listdir(assets_path) if f.endswith('.js')]
            total_size = sum(os.path.getsize(os.path.join(assets_path, f)) for f in js_files)
            total_mb = total_size / (1024 * 1024)
            
            print(f"   - Bundle size: {total_mb:.2f} MB")
            if total_mb > 3:
                print("   ⚠️  Large bundle detected - consider code splitting")
        
        print("   ✅ React build exists")
    else:
        print("   ⚠️  React build not found - run: npm run build")
    
    # Recommendations
    print(f"\n🎯 Performance Recommendations:")
    
    score = 0
    max_score = 5
    
    if CACHE_ENABLED:
        print("   ✅ Caching is enabled")
        score += 1
    else:
        print("   ❌ Enable caching: Set CACHE_ENABLED=true")
    
    if redis_available:
        print("   ✅ Redis package available")
        score += 1
    else:
        print("   ❌ Install Redis: pip install redis==5.0.1")
    
    if REDIS_ENABLED and cache.enabled:
        print("   ✅ Redis is active")
        score += 2
    elif redis_available:
        print("   ⚠️  Redis available but not enabled")
        print("      Set environment variables:")
        print("      - REDIS_ENABLED=true")
        print("      - REDIS_HOST=your-redis-host")
        print("      - REDIS_PASSWORD=your-redis-password")
    
    if os.path.exists(client_path):
        print("   ✅ Frontend build exists")
        score += 1
    else:
        print("   ❌ Build frontend: cd client && npm run build")
    
    print(f"\n📈 Performance Score: {score}/{max_score}")
    
    if score >= 4:
        print("   🎉 Excellent! Your app is well optimized.")
    elif score >= 2:
        print("   ⚡ Good! Follow recommendations above for better performance.")
    else:
        print("   ⚠️  Action needed! Your app performance can be significantly improved.")
    
    print(f"\n📚 See ENABLE_REDIS.md for detailed setup instructions")
    print("=" * 50)

if __name__ == '__main__':
    optimize_app()
