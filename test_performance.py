#!/usr/bin/env python3
"""
Performance Testing Script for C.Point
Tests dashboard and community feed loading times with Redis caching
"""

import requests
import time
import statistics
from datetime import datetime

# Configuration
BASE_URL = "https://www.c-point.co"
TEST_USER = {
    "username": "Paulo",  # Update with test username
    "password": "your_password"  # Update with test password
}

class PerformanceTest:
    def __init__(self, base_url):
        self.base_url = base_url
        self.session = requests.Session()
        
    def login(self, username, password):
        """Login to get session cookie"""
        print(f"\n🔐 Logging in as {username}...")
        
        # First get CSRF token if needed
        try:
            login_url = f"{self.base_url}/login"
            response = self.session.post(
                login_url,
                data={"username": username, "password": password},
                allow_redirects=True
            )
            
            if response.status_code == 200:
                print("   ✅ Login successful")
                return True
            else:
                print(f"   ❌ Login failed: {response.status_code}")
                return False
        except Exception as e:
            print(f"   ❌ Login error: {e}")
            return False
    
    def test_endpoint(self, endpoint, name, iterations=5):
        """Test an endpoint multiple times and return stats"""
        print(f"\n📊 Testing {name}")
        print(f"   Endpoint: {endpoint}")
        print(f"   Iterations: {iterations}")
        print(f"   {'─' * 60}")
        
        times = []
        
        for i in range(iterations):
            try:
                start = time.time()
                response = self.session.get(f"{self.base_url}{endpoint}")
                elapsed = (time.time() - start) * 1000  # Convert to ms
                
                status = "✅" if response.status_code == 200 else "❌"
                cache_status = ""
                
                # Check if response came from cache
                if 'X-Cache' in response.headers:
                    cache_status = f"(Cache: {response.headers['X-Cache']})"
                
                print(f"   {status} Request {i+1}: {elapsed:.2f}ms {cache_status}")
                
                if response.status_code == 200:
                    times.append(elapsed)
                    
                # Small delay between requests
                time.sleep(0.1)
                
            except Exception as e:
                print(f"   ❌ Request {i+1} failed: {e}")
        
        if not times:
            print(f"   ⚠️  No successful requests")
            return None
        
        # Calculate statistics
        stats = {
            'min': min(times),
            'max': max(times),
            'avg': statistics.mean(times),
            'median': statistics.median(times),
            'first_load': times[0],
            'cached_avg': statistics.mean(times[1:]) if len(times) > 1 else times[0]
        }
        
        print(f"\n   📈 Results:")
        print(f"      First Load:  {stats['first_load']:.2f}ms (cache miss)")
        print(f"      Cached Avg:  {stats['cached_avg']:.2f}ms (cache hit)")
        print(f"      Min:         {stats['min']:.2f}ms")
        print(f"      Max:         {stats['max']:.2f}ms")
        print(f"      Average:     {stats['avg']:.2f}ms")
        print(f"      Median:      {stats['median']:.2f}ms")
        
        # Calculate improvement
        if stats['first_load'] > stats['cached_avg']:
            improvement = ((stats['first_load'] - stats['cached_avg']) / stats['first_load']) * 100
            speedup = stats['first_load'] / stats['cached_avg']
            print(f"      🚀 Cache Improvement: {improvement:.1f}% faster ({speedup:.1f}x speedup)")
        
        return stats
    
    def test_dashboard(self, iterations=5):
        """Test dashboard loading time"""
        return self.test_endpoint("/premium_dashboard", "Dashboard", iterations)
    
    def test_community_feed(self, community_id=21, iterations=5):
        """Test community feed loading time"""
        endpoint = f"/community_feed_react/{community_id}"
        return self.test_endpoint(endpoint, f"Community Feed (ID: {community_id})", iterations)
    
    def test_all(self, iterations=5):
        """Run all performance tests"""
        print("=" * 80)
        print("🚀 C.Point Performance Test Suite")
        print("=" * 80)
        print(f"   Base URL: {self.base_url}")
        print(f"   Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        
        results = {}
        
        # Test Dashboard
        results['dashboard'] = self.test_dashboard(iterations)
        
        # Test Community Feed
        results['community_feed'] = self.test_community_feed(iterations=iterations)
        
        # Summary
        print("\n" + "=" * 80)
        print("📊 Performance Summary")
        print("=" * 80)
        
        if results['dashboard']:
            print(f"\n✅ Dashboard:")
            print(f"   First Load:  {results['dashboard']['first_load']:.2f}ms")
            print(f"   Cached Avg:  {results['dashboard']['cached_avg']:.2f}ms")
            
        if results['community_feed']:
            print(f"\n✅ Community Feed:")
            print(f"   First Load:  {results['community_feed']['first_load']:.2f}ms")
            print(f"   Cached Avg:  {results['community_feed']['cached_avg']:.2f}ms")
        
        print("\n" + "=" * 80)
        print("🎯 Performance Analysis")
        print("=" * 80)
        
        # Performance assessment
        if results['dashboard'] and results['dashboard']['cached_avg'] < 200:
            print("✅ Dashboard: EXCELLENT - Very fast (< 200ms)")
        elif results['dashboard'] and results['dashboard']['cached_avg'] < 500:
            print("⚡ Dashboard: GOOD - Fast (< 500ms)")
        elif results['dashboard']:
            print("⚠️  Dashboard: NEEDS IMPROVEMENT - Slow (> 500ms)")
        
        if results['community_feed'] and results['community_feed']['cached_avg'] < 200:
            print("✅ Community Feed: EXCELLENT - Very fast (< 200ms)")
        elif results['community_feed'] and results['community_feed']['cached_avg'] < 500:
            print("⚡ Community Feed: GOOD - Fast (< 500ms)")
        elif results['community_feed']:
            print("⚠️  Community Feed: NEEDS IMPROVEMENT - Slow (> 500ms)")
        
        print("\n💡 Recommendations:")
        
        if results['dashboard'] and results['dashboard']['cached_avg'] > 200:
            print("   - Consider optimizing database queries for dashboard")
            print("   - Check Redis cache hit rate")
        
        if results['community_feed'] and results['community_feed']['cached_avg'] > 200:
            print("   - Consider adding more indices to posts/replies tables")
            print("   - Increase cache TTL for community feeds")
        
        if (results['dashboard'] and results['dashboard']['cached_avg'] < 200 and
            results['community_feed'] and results['community_feed']['cached_avg'] < 200):
            print("   🎉 Performance is excellent! Redis caching is working great!")
        
        print("\n" + "=" * 80)
        
        return results

def main():
    """Run performance tests"""
    import sys
    
    # Check if running with auth
    if len(sys.argv) > 2:
        username = sys.argv[1]
        password = sys.argv[2]
    else:
        print("=" * 80)
        print("⚠️  No credentials provided - testing public endpoints only")
        print("=" * 80)
        print("\nTo test authenticated endpoints:")
        print("  python3 test_performance.py <username> <password>")
        print("\nTesting without authentication...")
        username = None
        password = None
    
    # Create test instance
    tester = PerformanceTest(BASE_URL)
    
    # Login if credentials provided
    if username and password:
        if not tester.login(username, password):
            print("\n❌ Login failed. Testing public endpoints only.")
    
    # Run tests
    iterations = 5
    if len(sys.argv) > 3:
        iterations = int(sys.argv[3])
    
    results = tester.test_all(iterations=iterations)
    
    # Exit with status code based on performance
    if (results.get('dashboard') and results['dashboard']['cached_avg'] > 500) or \
       (results.get('community_feed') and results['community_feed']['cached_avg'] > 500):
        sys.exit(1)  # Performance issues
    else:
        sys.exit(0)  # Good performance

if __name__ == "__main__":
    main()
