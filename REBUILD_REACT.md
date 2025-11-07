# Rebuild React App - Quick Guide

## On Your PythonAnywhere Server

```bash
# 1. Exit musetalk_env if you're still in it
deactivate

# 2. Go to your directory
cd ~/WorkoutX/Links

# 3. Stash any local changes
git stash

# 4. Pull latest code (with talking avatar removed)
git pull origin main

# 5. Go to client directory
cd client

# 6. Install dependencies (if needed)
npm install

# 7. Build React app
npm run build

# 8. Go back to root
cd ..

# 9. Reload your app
touch /var/www/puntz08_pythonanywhere_com_wsgi.py
```

## Expected Output

The build should take 1-2 minutes and show:

```
> client@0.1.0 build
> tsc && vite build

vite v5.x.x building for production...
✓ 1234 modules transformed.
dist/index.html                   0.45 kB │ gzip:  0.30 kB
dist/assets/index-abc123.js      456.78 kB │ gzip: 123.45 kB
✓ built in 45.67s
```

## Verify

Visit your app - the talking avatar toggle buttons should be gone!

## If Build Fails

### Error: "npm: command not found"

```bash
# Install Node.js
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 18
nvm use 18
```

### Error: "out of memory"

```bash
# Build with limited memory
cd ~/WorkoutX/Links/client
NODE_OPTIONS="--max-old-space-size=512" npm run build
```

### Error: Module not found

```bash
# Clean install
cd ~/WorkoutX/Links/client
rm -rf node_modules package-lock.json
npm install
npm run build
```

## Done!

✅ React app rebuilt without talking avatar UI
✅ All changes live on your site
