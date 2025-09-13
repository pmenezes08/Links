#!/usr/bin/env python3
"""
Redis Caching Layer for C.Point App
Implements Redis caching to improve response times
"""

import redis
import json
import os
import logging
from datetime import datetime, timedelta
from functools import wraps

logger = logging.getLogger(__name__)

# Redis configuration
REDIS_HOST = os.environ.get('REDIS_HOST', 'localhost')
REDIS_PORT = int(os.environ.get('REDIS_PORT', 6379))
REDIS_PASSWORD = os.environ.get('REDIS_PASSWORD', None)
REDIS_DB = int(os.environ.get('REDIS_DB', 0))

# Cache settings
DEFAULT_CACHE_TTL = 300  # 5 minutes
USER_CACHE_TTL = 600     # 10 minutes
COMMUNITY_CACHE_TTL = 180 # 3 minutes
MESSAGE_CACHE_TTL = 60   # 1 minute

class RedisCache:
    def __init__(self):
        self.redis_client = None
        self.enabled = False
        self.connect()
    
    def connect(self):
        """Connect to Redis server"""
        try:
            self.redis_client = redis.Redis(
                host=REDIS_HOST,
                port=REDIS_PORT,
                password=REDIS_PASSWORD,
                db=REDIS_DB,
                decode_responses=True,
                socket_connect_timeout=5,
                socket_timeout=5
            )
            
            # Test connection
            self.redis_client.ping()
            self.enabled = True
            logger.info(f"✅ Redis connected successfully at {REDIS_HOST}:{REDIS_PORT}")
            
        except Exception as e:
            logger.warning(f"⚠️ Redis connection failed: {e}")
            logger.warning("App will continue without caching")
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

# Global cache instance
cache = RedisCache()

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

def community_feed_cache_key(community_id, page=1):
    return f"community_feed:{community_id}:page:{page}"

def user_communities_cache_key(username):
    return f"user_communities:{username}"

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
    cache.delete(chat_threads_cache_key(username))
    cache.delete(user_communities_cache_key(username))
    logger.debug(f"🗑️ Invalidated user cache: {username}")

def invalidate_community_cache(community_id):
    """Invalidate community-related cache"""
    cache.delete(community_cache_key(community_id))
    cache.delete(community_members_cache_key(community_id))
    cache.delete_pattern(f"community_feed:{community_id}:*")
    logger.debug(f"🗑️ Invalidated community cache: {community_id}")

def invalidate_message_cache(username1, username2):
    """Invalidate message cache between two users"""
    cache.delete(messages_cache_key(username1, username2))
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