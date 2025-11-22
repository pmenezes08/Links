# Fix Python Path in WSGI File for Redis

## Issue:
Redis is installed in `/home/puntz08/.local/lib/python3.10/site-packages` but the web app can't find it.

## Solution:
Add the user site-packages to Python path in WSGI file.

---

## Edit Your WSGI File:

Open `/var/www/puntz08_pythonanywhere_com_wsgi.py`

**Add these lines RIGHT AT THE TOP (before any other code):**

```python
import sys
import site

# Add user site-packages (where redis is installed)
user_site_packages = site.getusersitepackages()
if user_site_packages not in sys.path:
    sys.path.insert(0, user_site_packages)

import os

# Core env
os.environ['CANONICAL_HOST'] = 'www.c-point.co'
...
# (rest of your existing WSGI config)
```

---

## Full WSGI File Should Look Like This:

```python
import sys
import site

# Add user site-packages (where redis is installed)
user_site_packages = site.getusersitepackages()
if user_site_packages not in sys.path:
    sys.path.insert(0, user_site_packages)

import os

# Core env
os.environ['CANONICAL_HOST'] = 'www.c-point.co'
os.environ['CANONICAL_SCHEME'] = 'https'
os.environ['SESSION_COOKIE_DOMAIN'] = 'www.c-point.co'

# DB (MySQL)
os.environ['DB_BACKEND'] = 'mysql'
os.environ['MYSQL_HOST'] = 'puntz08.mysql.pythonanywhere-services.com'
os.environ['MYSQL_DB'] = 'puntz08$C-Point'
os.environ['MYSQL_USER'] = 'puntz08'
os.environ['MYSQL_PASSWORD'] = 'Trying123456'

# Redis Cloud Configuration
os.environ['REDIS_ENABLED'] = 'true'
os.environ['REDIS_HOST'] = 'redis-12834.c275.us-east-1-4.ec2.cloud.redislabs.com'
os.environ['REDIS_PORT'] = '12834'
os.environ['REDIS_USERNAME'] = 'default'
os.environ['REDIS_PASSWORD'] = '9wrV3MjrTnIC9uTcaEqrAvrW2fOsqdxV'

# Add your project directory to sys.path
path = '/home/puntz08/WorkoutX/Links'
if path not in sys.path:
    sys.path.append(path)

# Import Flask app
from bodybuilding_app import app as application
```

---

## After Editing:

1. Save the WSGI file
2. Go to **Web tab**
3. Click green **Reload** button
4. Check logs - you should see:
   ```
   ✅ redis module imported successfully from: /home/puntz08/.local/lib/python3.10/site-packages/redis/__init__.py
   REDIS_AVAILABLE: True
   ✅ Redis connected successfully...
   ```

---

## Why This Works:

PythonAnywhere's web app runs with a different Python environment than the bash console. Adding `site.getusersitepackages()` to sys.path tells Python where to find packages installed with `--user`.
