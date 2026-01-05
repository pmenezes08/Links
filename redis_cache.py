#!/usr/bin/env python3
"""
Redis Caching Layer for C.Point App
Implements Redis caching to improve response times
"""

import json
import os
import logging
import time
from datetime import datetime, timedelta
from functools import wraps
from threading import Lock

logger = logging.getLogger(__name__)

# Try to import Redis, fall back to in-memory cache if not available
try:
    import redis
    REDIS_AVAILABLE = True
    print(f"✅ redis module imported successfully from: {redis.__file__}", flush=True)
except ImportError as e:
    REDIS_AVAILABLE = False
    msg = f"❌ Failed to import redis: {e}"
    logger.info(msg)
    print(msg, flush=True)
    import sys
    print(f"   Python path: {sys.path[:3]}...", flush=True)

# Configuration
REDIS_ENABLED = os.environ.get('REDIS_ENABLED', 'false').lower() == 'true' and REDIS_AVAILABLE
CACHE_ENABLED = os.environ.get('CACHE_ENABLED', 'true').lower() == 'true'
REDIS_HOST = os.environ.get('REDIS_HOST', 'localhost')
REDIS_PORT = int(os.environ.get('REDIS_PORT', 6379))
REDIS_PASSWORD = os.environ.get('REDIS_PASSWORD', None)
REDIS_DB = int(os.environ.get('REDIS_DB', 0))

# Cache settings (optimized for performance)
DEFAULT_CACHE_TTL = int(os.environ.get('CACHE_TTL_DEFAULT', '300'))  # 5 minutes
USER_CACHE_TTL = int(os.environ.get('CACHE_TTL_PROFILES', '900'))    # 15 minutes
COMMUNITY_CACHE_TTL = int(os.environ.get('CACHE_TTL_COMMUNITIES', '300')) # 5 minutes
MESSAGE_CACHE_TTL = int(os.environ.get('CACHE_TTL_MESSAGES', '5'))  # 5 seconds to reduce stale windows
CHAT_THREADS_TTL = int(os.environ.get('CACHE_TTL_CHAT_THREADS', '120')) # 2 minutes
IMAGE_CACHE_TTL = int(os.environ.get('CACHE_TTL_IMAGES', '7200'))    # 2 hours

# Memory management
MAX_CACHE_ENTRIES = int(os.environ.get('CACHE_MAX_ENTRIES', '10000'))
CLEANUP_INTERVAL = int(os.environ.get('CACHE_CLEANUP_INTERVAL', '100'))

class MemoryCache:
    """In-memory cache with TTL support for PythonAnywhere"""
    def __init__(self):
        self.cache = {}
        self.expiry = {}
        self.lock = Lock()
        self.enabled = CACHE_ENABLED
        logger.info("✅ In-memory cache initialized")
    
    def _cleanup_expired(self):
        """Remove expired entries"""
        current_time = time.time()
        expired_keys = [key for key, exp_time in self.expiry.items() if exp_time < current_time]
        for key in expired_keys:
            self.cache.pop(key, None)
            self.expiry.pop(key, None)
    
    def get(self, key):
        """Get value from cache"""
        if not self.enabled:
            return None
        
        with self.lock:
            self._cleanup_expired()
            
            if key in self.cache and key in self.expiry:
                if self.expiry[key] > time.time():
                    return self.cache[key]
                else:
                    # Expired
                    self.cache.pop(key, None)
                    self.expiry.pop(key, None)
            
            return None
    
    def set(self, key, value, ttl=DEFAULT_CACHE_TTL):
        """Set value in cache with TTL"""
        if not self.enabled:
            return False
        
        with self.lock:
            self.cache[key] = value
            self.expiry[key] = time.time() + ttl
            
            # Memory management - prevent overflow
            if len(self.cache) > MAX_CACHE_ENTRIES:
                # Remove oldest entries
                sorted_keys = sorted(self.expiry.items(), key=lambda x: x[1])
                keys_to_remove = [k for k, _ in sorted_keys[:MAX_CACHE_ENTRIES//4]]  # Remove 25%
                for key in keys_to_remove:
                    self.cache.pop(key, None)
                    self.expiry.pop(key, None)
                logger.info(f"🧹 Cleaned up {len(keys_to_remove)} cache entries")
            
            # Cleanup expired entries occasionally
            if len(self.cache) % CLEANUP_INTERVAL == 0:
                self._cleanup_expired()
            
            return True
    
    def delete(self, key):
        """Delete key from cache"""
        if not self.enabled:
            return False
        
        with self.lock:
            self.cache.pop(key, None)
            self.expiry.pop(key, None)
            return True
    
    def delete_pattern(self, pattern):
        """Delete all keys matching pattern"""
        if not self.enabled:
            return False
        
        with self.lock:
            # Simple pattern matching for in-memory cache
            pattern_clean = pattern.replace('*', '')
            keys_to_delete = [key for key in self.cache.keys() if pattern_clean in key]
            for key in keys_to_delete:
                self.cache.pop(key, None)
                self.expiry.pop(key, None)
            return True
    
    def flush_all(self):
        """Clear all cache"""
        if not self.enabled:
            return False
        
        with self.lock:
            self.cache.clear()
            self.expiry.clear()
            logger.info("🗑️ Memory cache cleared")
            return True

class RedisCache:
    def __init__(self):
        self.redis_client = None
        self.enabled = False
        if REDIS_ENABLED:
            self.connect()
    
    def connect(self):
        """Connect to Redis server"""
        try:
            # Redis Cloud connection with username support
            redis_kwargs = {
                'host': REDIS_HOST,
                'port': REDIS_PORT,
                'password': REDIS_PASSWORD,
                'db': REDIS_DB,
                'decode_responses': True,
                'socket_connect_timeout': 5,
                'socket_timeout': 5
            }
            
            # Add username if provided (Redis Cloud requires this)
            redis_username = os.environ.get('REDIS_USERNAME')
            if redis_username:
                redis_kwargs['username'] = redis_username
            
            self.redis_client = redis.Redis(**redis_kwargs)
            
            # Test connection
            self.redis_client.ping()
            self.enabled = True
            msg = f"✅ Redis connected successfully at {REDIS_HOST}:{REDIS_PORT}"
            logger.info(msg)
            print(msg, flush=True)  # Ensure it appears in error log
            
        except Exception as e:
            msg1 = f"⚠️ Redis connection failed: {e}"
            msg2 = "Falling back to in-memory cache"
            logger.warning(msg1)
            logger.warning(msg2)
            print(msg1, flush=True)
            print(msg2, flush=True)
            self.enabled = False
    
    def get(self, key):
        """Get value from cache"""
        if not self.enabled:
            return None
        
        try:
            value = self.redis_client.get(key)
            if value:
                return json.loads(value)
            return None
        except Exception as e:
            logger.warning(f"Redis get error for key {key}: {e}")
            return None
    
    def set(self, key, value, ttl=DEFAULT_CACHE_TTL):
        """Set value in cache with TTL"""
        if not self.enabled:
            return False
        
        try:
            json_value = json.dumps(value, default=str)
            self.redis_client.setex(key, ttl, json_value)
            return True
        except Exception as e:
            logger.warning(f"Redis set error for key {key}: {e}")
            return False
    
    def delete(self, key):
        """Delete key from cache"""
        if not self.enabled:
            return False
        
        try:
            self.redis_client.delete(key)
            return True
        except Exception as e:
            logger.warning(f"Redis delete error for key {key}: {e}")
            return False
    
    def delete_pattern(self, pattern):
        """Delete all keys matching pattern"""
        if not self.enabled:
            return False
        
        try:
            keys = self.redis_client.keys(pattern)
            if keys:
                self.redis_client.delete(*keys)
            return True
        except Exception as e:
            logger.warning(f"Redis delete pattern error for {pattern}: {e}")
            return False
    
    def flush_all(self):
        """Clear all cache"""
        if not self.enabled:
            return False
        
        try:
            self.redis_client.flushdb()
            logger.info("🗑️ Redis cache cleared")
            return True
        except Exception as e:
            logger.warning(f"Redis flush error: {e}")
            return False

# Smart cache selection based on performance
def create_optimal_cache():
    """Create the fastest cache available"""
    if REDIS_ENABLED:
        redis_cache = RedisCache()
        if redis_cache.enabled:
            # Test Redis performance
            import time
            try:
                start = time.time()
                redis_cache.redis_client.ping()
                ping_time = (time.time() - start) * 1000
                
                if ping_time < 100:  # If Redis is fast (< 100ms)
                    msg = f"🚀 Using Redis cache (ping: {ping_time:.1f}ms)"
                    logger.info(msg)
                    print(msg, flush=True)
                    return redis_cache
                else:
                    msg = f"⚠️ Redis too slow (ping: {ping_time:.1f}ms), using in-memory cache"
                    logger.warning(msg)
                    print(msg, flush=True)
                    return MemoryCache()
            except:
                msg = "Redis performance test failed, using in-memory cache"
                logger.warning(msg)
                print(msg, flush=True)
                return MemoryCache()
    
    msg = "💾 Using optimized in-memory cache"
    logger.info(msg)
    print(msg, flush=True)
    return MemoryCache()

# Global cache instance - automatically selects fastest option
print("🔧 Initializing cache system...", flush=True)
print(f"   REDIS_ENABLED: {REDIS_ENABLED}", flush=True)
print(f"   REDIS_AVAILABLE: {REDIS_AVAILABLE}", flush=True)
print(f"   CACHE_ENABLED: {CACHE_ENABLED}", flush=True)
if REDIS_ENABLED:
    print(f"   REDIS_HOST: {REDIS_HOST}", flush=True)
    print(f"   REDIS_PORT: {REDIS_PORT}", flush=True)
cache = create_optimal_cache()
print(f"✅ Cache initialized: {type(cache).__name__}", flush=True)

# Cache key generators
def user_cache_key(username):
    return f"user:{username}"

def user_profile_cache_key(username):
    return f"user_profile:{username}"

def community_cache_key(community_id):
    return f"community:{community_id}"

def community_members_cache_key(community_id):
    return f"community_members:{community_id}"

def chat_threads_cache_key(username):
    return f"chat_threads:{username}"

def messages_cache_key(user1, user2):
    # Sort usernames for consistent key
    users = sorted([user1, user2])
    return f"messages:{users[0]}:{users[1]}"

def messages_view_cache_key(viewer, peer):
    """Viewer-specific cache key to avoid mixing 'sent' perspective across users"""
    return f"messages_view:{viewer}:{peer}"

def community_feed_cache_key(community_id, page=1):
    return f"community_feed:{community_id}:page:{page}"

def user_communities_cache_key(username):
    return f"user_communities:{username}"

def community_feed_user_cache_key(community_id, username):
    return f"community_feed:{community_id}:user:{username}"

def user_parent_dashboard_cache_key(username):
    return f"user_parent_dashboard:{username}"

def user_community_tree_cache_key(username):
    return f"user_community_tree:{username}"

# Caching decorators
def cache_result(key_func, ttl=DEFAULT_CACHE_TTL):
    """Decorator to cache function results"""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            # Generate cache key
            cache_key = key_func(*args, **kwargs)
            
            # Try to get from cache first
            cached_result = cache.get(cache_key)
            if cached_result is not None:
                logger.debug(f"🚀 Cache hit: {cache_key}")
                return cached_result
            
            # Cache miss - execute function
            logger.debug(f"💾 Cache miss: {cache_key}")
            result = func(*args, **kwargs)
            
            # Store in cache
            cache.set(cache_key, result, ttl)
            
            return result
        return wrapper
    return decorator

# Cache invalidation helpers
def invalidate_user_cache(username):
    """Invalidate all user-related cache"""
    cache.delete(user_cache_key(username))
    cache.delete(user_profile_cache_key(username))
    cache.delete(f"profile:{username}")  # Used by /api/profile_me endpoint
    cache.delete(chat_threads_cache_key(username))
    cache.delete(user_communities_cache_key(username))
    cache.delete(user_parent_dashboard_cache_key(username))
    cache.delete(user_community_tree_cache_key(username))
    logger.debug(f"🗑️ Invalidated user cache: {username}")

def invalidate_community_cache(community_id):
    """Invalidate community-related cache"""
    cache.delete(community_cache_key(community_id))
    cache.delete(community_members_cache_key(community_id))
    cache.delete_pattern(f"community_feed:{community_id}:*")
    logger.debug(f"🗑️ Invalidated community cache: {community_id}")

def invalidate_message_cache(username1, username2):
    """Invalidate message cache between two users"""
    # Symmetric thread cache
    cache.delete(messages_cache_key(username1, username2))
    # Viewer-specific message lists (avoid stale 'sent' perspective)
    cache.delete(messages_view_cache_key(username1, username2))
    cache.delete(messages_view_cache_key(username2, username1))
    # Thread lists
    cache.delete(chat_threads_cache_key(username1))
    cache.delete(chat_threads_cache_key(username2))
    logger.debug(f"🗑️ Invalidated message cache: {username1} ↔ {username2}")

# Performance monitoring
def get_cache_stats():
    """Get Redis cache statistics"""
    if not cache.enabled:
        return {'enabled': False}
    
    try:
        info = cache.redis_client.info()
        return {
            'enabled': True,
            'connected_clients': info.get('connected_clients', 0),
            'used_memory_human': info.get('used_memory_human', '0B'),
            'keyspace_hits': info.get('keyspace_hits', 0),
            'keyspace_misses': info.get('keyspace_misses', 0),
            'hit_rate': round(info.get('keyspace_hits', 0) / max(info.get('keyspace_hits', 0) + info.get('keyspace_misses', 0), 1) * 100, 2)
        }
    except Exception as e:
        logger.error(f"Error getting cache stats: {e}")
        return {'enabled': False, 'error': str(e)}