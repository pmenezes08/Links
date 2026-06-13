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
    print(f"OK redis module imported successfully from: {redis.__file__}", flush=True)
except ImportError as e:
    REDIS_AVAILABLE = False
    msg = f"ERROR Failed to import redis: {e}"
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

# Per-process connection-pool bound. Each web process serves every Redis op from
# one bounded BlockingConnectionPool, so cluster-wide connections are roughly
# REDIS_MAX_CONNECTIONS x (live Cloud Run instances). Keep this comfortably under
# the managed Redis plan's connection ceiling.
#
# Plan: Redis Cloud Essentials, 256 MB tier (europe-west1) — 256-connection limit
# (upgraded 2026-06-13 from the 30 MB / 30-connection tier, whose ceiling was
# tripped by Cloud Run autoscaling and produced "connections limit" alerts).
# With the default cap of 8, ~30 concurrent instances fit inside 256. Tune via
# the REDIS_MAX_CONNECTIONS env var without a code change.
REDIS_MAX_CONNECTIONS = int(os.environ.get('REDIS_MAX_CONNECTIONS', '8'))
# Seconds a caller blocks waiting for a free pooled connection before erroring
# (degrades to a cache miss) instead of opening an unbounded extra socket. Kept
# SHORT on purpose: the pool cap equals the gunicorn thread count (Dockerfile
# runs --threads 8) and the SAME pool is drawn by ~12 background daemon threads
# (imagine-job executor, backfills, per-DM Steve typing heartbeats). When they
# contend, a *request* thread must not stall for a connection — it degrades to a
# fast cache-miss instead. Only raise this together with REDIS_MAX_CONNECTIONS,
# and only if --max-instances headroom keeps cap x instances under the plan's
# connection ceiling.
REDIS_POOL_TIMEOUT = int(os.environ.get('REDIS_POOL_TIMEOUT', '1'))
# After a connection failure the client is disabled and serves cache-misses; it
# retries connecting at most once per this cooldown (seconds), so a transient
# Redis blip self-heals instead of condemning the whole instance to no-cache for
# the rest of its life. See RedisCache._ensure_connected.
REDIS_RECONNECT_COOLDOWN = int(os.environ.get('REDIS_RECONNECT_COOLDOWN', '30'))

# Cache settings (optimized for performance)
DEFAULT_CACHE_TTL = int(os.environ.get('CACHE_TTL_DEFAULT', '300'))  # 5 minutes
USER_CACHE_TTL = int(os.environ.get('CACHE_TTL_PROFILES', '900'))    # 15 minutes
COMMUNITY_CACHE_TTL = int(os.environ.get('CACHE_TTL_COMMUNITIES', '300')) # 5 minutes
# Shorter TTL for parent dashboard JSON (includes volatile unread counts).
CACHE_TTL_USER_PARENT_DASHBOARD = int(os.environ.get('CACHE_TTL_USER_PARENT_DASHBOARD', '120'))
MESSAGE_CACHE_TTL = int(os.environ.get('CACHE_TTL_MESSAGES', '5'))  # 5 seconds to reduce stale windows
CHAT_THREADS_TTL = int(os.environ.get('CACHE_TTL_CHAT_THREADS', '120')) # 2 minutes
IMAGE_CACHE_TTL = int(os.environ.get('CACHE_TTL_IMAGES', '7200'))    # 2 hours
# Post detail cache (viewer-scoped, versioned prefix). Tight TTL so a stale
# blob is short-lived; explicit invalidation runs at mutation sites.
CACHE_TTL_POST_DETAIL = int(os.environ.get('CACHE_TTL_POST_DETAIL', '180'))
CACHE_TTL_POST_DETAIL_METRICS = int(os.environ.get('CACHE_TTL_POST_DETAIL_METRICS', '30'))
POST_DETAIL_CACHE_VERSION = os.environ.get('POST_DETAIL_CACHE_VERSION', 'v1')

# Memory management
MAX_CACHE_ENTRIES = int(os.environ.get('CACHE_MAX_ENTRIES', '10000'))
CLEANUP_INTERVAL = int(os.environ.get('CACHE_CLEANUP_INTERVAL', '100'))

class MemoryCache:
    """In-memory cache with TTL support for Cloud Run"""
    def __init__(self):
        self.cache = {}
        self.expiry = {}
        self.lock = Lock()
        self.enabled = CACHE_ENABLED
        logger.info("OK In-memory cache initialized")
    
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
        # Timestamp of the last connect() attempt, used to rate-limit reconnects
        # after a failure (see _ensure_connected). 0.0 = never attempted.
        self._last_connect_attempt = 0.0
        if REDIS_ENABLED:
            self.connect()
    
    def connect(self):
        """Connect to Redis server.

        Connections are served from a bounded ``BlockingConnectionPool`` so a
        single process can never exceed ``REDIS_MAX_CONNECTIONS`` open sockets.
        Under thread concurrency a caller blocks (up to ``REDIS_POOL_TIMEOUT``s)
        for a free connection rather than opening unbounded extra sockets — this
        is what keeps the cluster-wide count under the managed Redis plan's
        connection ceiling. See the REDIS_MAX_CONNECTIONS note above.
        """
        self._last_connect_attempt = time.time()
        # Tear down any prior (dead) pool before building a fresh one, so a
        # reconnect never leaks the old sockets against the connection ceiling.
        if self.redis_client is not None:
            try:
                self.redis_client.connection_pool.disconnect()
            except Exception:
                pass
        try:
            # Redis Cloud connection with username support
            connection_kwargs = {
                'host': REDIS_HOST,
                'port': REDIS_PORT,
                'password': REDIS_PASSWORD,
                'db': REDIS_DB,
                'decode_responses': True,
                'socket_connect_timeout': 5,
                'socket_timeout': 5,
                # Recycle half-open connections instead of leaking them as stale
                # sockets that still count against the plan's connection limit.
                'socket_keepalive': True,
                'health_check_interval': 30,
            }

            # Add username if provided (Redis Cloud requires this)
            redis_username = os.environ.get('REDIS_USERNAME')
            if redis_username:
                connection_kwargs['username'] = redis_username

            pool = redis.BlockingConnectionPool(
                max_connections=REDIS_MAX_CONNECTIONS,
                timeout=REDIS_POOL_TIMEOUT,
                **connection_kwargs,
            )
            self.redis_client = redis.Redis(connection_pool=pool)

            # Test connection
            self.redis_client.ping()
            self.enabled = True
            msg = f"OK Redis connected successfully at {REDIS_HOST}:{REDIS_PORT}"
            logger.info(msg)
            print(msg, flush=True)  # Ensure it appears in error log
            
        except Exception as e:
            msg1 = f"WARNING Redis connection failed: {e}"
            msg2 = f"Cache disabled; serving cache-misses and retrying every {REDIS_RECONNECT_COOLDOWN}s"
            logger.warning(msg1)
            logger.warning(msg2)
            print(msg1, flush=True)
            print(msg2, flush=True)
            self.enabled = False

    def _ensure_connected(self):
        """Return True if the pooled client is usable, attempting one rate-limited
        reconnect if it isn't.

        A connection failure (at boot or mid-life) sets ``enabled=False`` and the
        client serves cache-misses. Rather than leave the whole instance without
        a shared cache for the rest of its life — which would split cache
        coherence across Cloud Run instances — this retries ``connect()`` at most
        once per ``REDIS_RECONNECT_COOLDOWN`` so a transient blip self-heals. The
        hot path (already connected) is a single attribute check.
        """
        if self.enabled:
            return True
        if (time.time() - self._last_connect_attempt) < REDIS_RECONNECT_COOLDOWN:
            return False
        self.connect()  # updates _last_connect_attempt; flips enabled on success
        return self.enabled

    def get(self, key):
        """Get value from cache"""
        if not self._ensure_connected():
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
        if not self._ensure_connected():
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
        if not self._ensure_connected():
            return False

        try:
            self.redis_client.delete(key)
            return True
        except Exception as e:
            logger.warning(f"Redis delete error for key {key}: {e}")
            return False
    
    def delete_pattern(self, pattern):
        """Delete all keys matching pattern"""
        if not self._ensure_connected():
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
        if not self._ensure_connected():
            return False

        try:
            self.redis_client.flushdb()
            logger.info("🗑️ Redis cache cleared")
            return True
        except Exception as e:
            logger.warning(f"Redis flush error: {e}")
            return False

# Smart cache selection
def create_optimal_cache():
    """Return the cache backend.

    When Redis is configured (REDIS_ENABLED) we ALWAYS return the RedisCache —
    even if the initial connect failed or the first ping was slow. A RedisCache
    degrades to a per-op cache-miss while disabled and lazily reconnects (see
    RedisCache._ensure_connected), so a transient boot-time blip never condemns a
    whole instance to a non-shared in-memory cache for its entire lifetime, which
    would split cache coherence across Cloud Run instances (one instance has a
    post, another doesn't). MemoryCache is only used when Redis isn't configured
    at all (local/dev).
    """
    if REDIS_ENABLED:
        redis_cache = RedisCache()
        if redis_cache.enabled:
            # Observe ping latency for the log, but never downgrade on it — a slow
            # one-shot ping during a contended cold start is not a reason to drop
            # the whole instance off the shared cache.
            try:
                start = time.time()
                redis_cache.redis_client.ping()
                ping_ms = (time.time() - start) * 1000
                msg = f"OK Using Redis cache (ping: {ping_ms:.1f}ms)"
            except Exception:
                msg = "OK Using Redis cache (ping check skipped)"
            logger.info(msg)
            print(msg, flush=True)
        else:
            msg = ("WARNING Redis configured but initial connect failed; serving "
                   "cache-misses and retrying — NOT downgrading to a per-instance cache")
            logger.warning(msg)
            print(msg, flush=True)
        return redis_cache

    msg = "Using optimized in-memory cache (Redis not enabled)"
    logger.info(msg)
    print(msg, flush=True)
    return MemoryCache()

# Global cache instance - automatically selects fastest option
print("Initializing cache system...", flush=True)
print(f"   REDIS_ENABLED: {REDIS_ENABLED}", flush=True)
print(f"   REDIS_AVAILABLE: {REDIS_AVAILABLE}", flush=True)
print(f"   CACHE_ENABLED: {CACHE_ENABLED}", flush=True)
if REDIS_ENABLED:
    print(f"   REDIS_HOST: {REDIS_HOST}", flush=True)
    print(f"   REDIS_PORT: {REDIS_PORT}", flush=True)
cache = create_optimal_cache()
print(f"OK Cache initialized: {type(cache).__name__}", flush=True)

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

def steve_dm_typing_key(viewer, peer):
    """Viewer-specific Steve typing indicator key for 1:1 DM threads."""
    return f"steve_dm_typing:{viewer}:{peer}"

def steve_dm_inflight_key(user_a, user_b):
    """Single in-flight Steve DM turn per sorted human pair (direct Steve or @Steve in peer DM)."""
    pair = sorted([(user_a or "").lower(), (user_b or "").lower()])
    return f"steve_dm_inflight:{pair[0]}:{pair[1]}"

def steve_group_typing_key(group_id):
    return f"steve_group_typing:{group_id}"

def community_feed_cache_key(community_id, page=1):
    return f"community_feed:{community_id}:page:{page}"

def user_communities_cache_key(username):
    return f"user_communities:{username}"

def community_feed_user_cache_key(community_id, username):
    return f"community_feed:{community_id}:user:{username}"

def user_parent_dashboard_cache_key(username):
    return f"user_parent_dashboard:{username}"


# --- Post detail cache keys (viewer-scoped, versioned) -----------------------

def post_detail_community_cache_key(post_id, viewer):
    """Viewer-scoped key for a community/general post detail blob."""
    return f"post_detail:{POST_DETAIL_CACHE_VERSION}:community:{int(post_id)}:viewer:{(viewer or '_anon').lower()}"


def post_detail_group_cache_key(post_id, viewer):
    """Viewer-scoped key for a group post detail blob."""
    return f"post_detail:{POST_DETAIL_CACHE_VERSION}:group:{int(post_id)}:viewer:{(viewer or '_anon').lower()}"


def post_detail_community_cache_pattern(post_id):
    """Wildcard pattern for invalidating every viewer of one community post."""
    return f"post_detail:{POST_DETAIL_CACHE_VERSION}:community:{int(post_id)}:viewer:*"


def post_detail_group_cache_pattern(post_id):
    """Wildcard pattern for invalidating every viewer of one group post."""
    return f"post_detail:{POST_DETAIL_CACHE_VERSION}:group:{int(post_id)}:viewer:*"

def user_community_tree_cache_key(username):
    return f"user_community_tree:{username}"

def invalidate_user_parent_dashboard(username):
    """Invalidate cached dashboard payloads that include unread post counts."""
    if not username:
        return
    try:
        cache.delete(user_parent_dashboard_cache_key(username))
        cache.delete(user_community_tree_cache_key(username))
    except Exception as e:
        logger.warning("invalidate_user_parent_dashboard failed for %s: %s", username, e)

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
    # Public profile JSON is cached per viewer: public_profile:<owner>:<viewer|_anon>
    try:
        cache.delete_pattern(f"public_profile:{username}:*")
    except Exception as pub_err:
        logger.warning(f"public_profile cache pattern delete failed for {username}: {pub_err}")
        cache.delete(f"public_profile:{username}:{username}")
        cache.delete(f"public_profile:{username}:_anon")
    cache.delete(chat_threads_cache_key(username))
    cache.delete(user_communities_cache_key(username))
    invalidate_user_parent_dashboard(username)
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