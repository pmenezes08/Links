# 🔍 Redis Troubleshooting Guide for Cloud Run

## Step-by-Step Diagnosis

---

## ✅ Step 1: Verify Redis Package is Installed

In Cloud Run **Bash console**:

```bash
pip list | grep redis
```

**Expected output:**
```
redis    5.0.1
```

If not installed:
```bash
pip install redis==5.0.1 --user
```

---

## ✅ Step 2: Verify WSGI File Configuration

Check your WSGI file:

```bash
cat Cloud Run service configuration | head -30
```

**It should look like this:**

```python
import os
import sys

# Redis Cloud Configuration - MUST BE AT THE VERY TOP
os.environ['REDIS_ENABLED'] = 'true'
os.environ['REDIS_HOST'] = 'redis-12834.c275.us-east-1-4.ec2.cloud.redislabs.com'
os.environ['REDIS_PORT'] = '12834'
os.environ['REDIS_USERNAME'] = 'default'
os.environ['REDIS_PASSWORD'] = '9wrV3MjrTnIC9uTcaEqrAvrW2fOsqdxV'

# Add your project directory to the sys.path
path = '/home/puntz08/WorkoutX/Links'  # or your actual path
if path not in sys.path:
    sys.path.insert(0, path)

# Import your Flask app
from bodybuilding_app import app as application
```

**CRITICAL:** These environment variables **MUST** be set **BEFORE** importing `bodybuilding_app`!

---

## ✅ Step 3: Check Application Logs

Go to Cloud Run **Web tab** → scroll to **Log files** → click **Error log**

### Look for one of these messages:

**✅ GOOD - Redis is working:**
```
✅ Redis connected successfully at redis-12834.c275.us-east-1-4.ec2.cloud.redislabs.com:12834
🚀 Using Redis cache (ping: XXms)
```

**❌ BAD - Redis not enabled:**
```
💾 Using optimized in-memory cache
Redis not available, using in-memory cache
```

**❌ BAD - Redis connection failed:**
```
⚠️ Redis connection failed: [error message]
⚠️ Redis too slow (ping: XXms), using in-memory cache
```

---

## ✅ Step 4: Test Redis from Python Console

In Cloud Run **Python console** (not Bash):

```python
import os
import sys

# Set Redis config
os.environ['REDIS_ENABLED'] = 'true'
os.environ['REDIS_HOST'] = 'redis-12834.c275.us-east-1-4.ec2.cloud.redislabs.com'
os.environ['REDIS_PORT'] = '12834'
os.environ['REDIS_USERNAME'] = 'default'
os.environ['REDIS_PASSWORD'] = '9wrV3MjrTnIC9uTcaEqrAvrW2fOsqdxV'

# Add your project path
sys.path.insert(0, '/home/puntz08/WorkoutX/Links')

# Now import and test
from redis_cache import cache, REDIS_ENABLED

print(f"REDIS_ENABLED: {REDIS_ENABLED}")
print(f"Cache enabled: {cache.enabled}")
print(f"Cache type: {type(cache).__name__}")

if hasattr(cache, 'redis_client'):
    try:
        cache.redis_client.ping()
        print("✅ Redis PING successful!")
        info = cache.redis_client.info()
        print(f"Connected clients: {info.get('connected_clients', 0)}")
    except Exception as e:
        print(f"❌ Redis error: {e}")
else:
    print("❌ Using in-memory cache, not Redis")
```

---

## ✅ Step 5: Verify Environment Variables are Set

After reloading, check if environment variables are actually set.

Add this temporary endpoint to `bodybuilding_app.py`:

```python
@app.route('/debug/env-check')
def debug_env():
    import os
    return {
        'REDIS_ENABLED': os.environ.get('REDIS_ENABLED', 'NOT SET'),
        'REDIS_HOST': os.environ.get('REDIS_HOST', 'NOT SET'),
        'REDIS_PORT': os.environ.get('REDIS_PORT', 'NOT SET'),
        'REDIS_USERNAME': os.environ.get('REDIS_USERNAME', 'NOT SET'),
        'REDIS_PASSWORD': 'SET' if os.environ.get('REDIS_PASSWORD') else 'NOT SET',
    }
```

Visit: `https://app.c-point.co/debug/env-check`

**Expected output:**
```json
{
  "REDIS_ENABLED": "true",
  "REDIS_HOST": "redis-12834.c275.us-east-1-4.ec2.cloud.redislabs.com",
  "REDIS_PORT": "12834",
  "REDIS_USERNAME": "default",
  "REDIS_PASSWORD": "SET"
}
```

---

## 🚨 Common Issues & Fixes

### Issue 1: "Redis not available, using in-memory cache"

**Cause:** Redis package not installed

**Fix:**
```bash
pip install redis==5.0.1 --user
# Then reload web app
```

---

### Issue 2: Environment Variables Not Set

**Cause:** WSGI file not configured correctly

**Fix:** Edit WSGI file, ensure Redis config is at **line 1-2**, BEFORE all other imports

**Wrong order:**
```python
import sys
from bodybuilding_app import app as application  # ❌ Too early!

# Redis config here  # ❌ Too late!
os.environ['REDIS_ENABLED'] = 'true'
```

**Correct order:**
```python
import os
import sys

# Redis config FIRST
os.environ['REDIS_ENABLED'] = 'true'
os.environ['REDIS_HOST'] = '...'
# ... other env vars

# THEN import app
from bodybuilding_app import app as application  # ✅ After env vars
```

---

### Issue 3: "Connected clients: 0"

**Possible causes:**

1. **Web app not reloaded** after WSGI changes
   - Go to Web tab → Click green **Reload** button
   - Wait 30 seconds for full reload

2. **Redis config set AFTER importing app**
   - Environment variables must be set BEFORE `from bodybuilding_app import ...`

3. **Typo in environment variable values**
   - Check for extra spaces: `'true '` vs `'true'`
   - Check spelling: `'REDIS_ENABLED'` not `'REDIS_ENABLE'`

4. **Using in-memory cache fallback**
   - Check logs for "Redis too slow" message
   - Check logs for connection errors

---

### Issue 4: "Redis connection failed"

**Possible causes:**

1. **Firewall/IP restrictions**
   - Check Redis Cloud dashboard → Security tab
   - Ensure Cloud Run IPs are allowed (or allow all)

2. **Wrong credentials**
   - Double-check password: `9wrV3MjrTnIC9uTcaEqrAvrW2fOsqdxV`
   - No spaces at start/end

3. **Network issues**
   - Redis Cloud might be down (rare)
   - Cloud Run network issues (rare)

---

## 🎯 Quick Checklist

Before asking for help, verify:

- [ ] Redis package installed: `pip list | grep redis`
- [ ] WSGI file has Redis config at the TOP (before imports)
- [ ] Web app has been reloaded (green button)
- [ ] Waited 30+ seconds after reload
- [ ] Checked error logs for connection messages
- [ ] No typos in environment variables
- [ ] Password is exactly: `9wrV3MjrTnIC9uTcaEqrAvrW2fOsqdxV`

---

## 📊 How to Verify It's Actually Working

### Method 1: Check Logs

**Error log** should show:
```
✅ Redis connected successfully at redis-12834...
```

### Method 2: Check Performance

1. Visit community feed
2. First load: Slow (cache miss)
3. Refresh page immediately
4. Second load: **Fast (< 0.2s)** = Redis working!

### Method 3: Check Redis Cloud Dashboard

Go to Redis Cloud dashboard → Your database

**Connected clients** should show **1** (or more if multiple workers)

### Method 4: Use Test Endpoint

If you added the debug endpoint:

Visit: `https://app.c-point.co/debug/redis-status`

Should show:
```json
{
  "redis_enabled": true,
  "connected": true,
  "redis_version": "8.2.1",
  ...
}
```

---

## 🆘 Still Not Working?

### Share these details:

1. **Output of:**
   ```bash
   pip list | grep redis
   ```

2. **First 30 lines of WSGI file:**
   ```bash
   head -30 Cloud Run service configuration
   ```

3. **Last 50 lines of error log** (from Cloud Run Web tab)

4. **Output of debug env check:** Visit `/debug/env-check`

5. **Confirmation that web app was reloaded** (timestamp of last reload)

---

## ✅ Success Indicators

You'll know Redis is working when:

1. ✅ Error log shows: "Redis connected successfully"
2. ✅ Community feed loads fast on second visit (< 0.2s)
3. ✅ Redis Cloud dashboard shows "Connected clients: 1+"
4. ✅ `/debug/redis-status` shows `"connected": true`

If you see all 4 = **Redis is working!** 🎉
