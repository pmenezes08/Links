#!/bin/bash
# Complete clean rebuild of iOS app

echo "============================================================"
echo "🧹 CLEAN iOS REBUILD SCRIPT"
echo "============================================================"
echo ""

# Step 1: Verify we're on latest code
echo "1️⃣ Checking git status..."
cd /workspace
git status
echo ""

echo "📥 Pulling latest code from main..."
git checkout main
git pull origin main
echo ""

# Step 2: Verify the changes are in the code
echo "2️⃣ Verifying changes are present..."
echo ""

echo "✓ Checking OnboardingWelcome.tsx for 'Connection Point':"
grep -n "Connection Point" /workspace/client/src/pages/OnboardingWelcome.tsx || echo "❌ NOT FOUND - Problem!"
echo ""

echo "✓ Checking if PwaInstallPrompt.tsx is deleted:"
if [ -f "/workspace/client/src/components/PwaInstallPrompt.tsx" ]; then
    echo "❌ FILE STILL EXISTS - Problem!"
else
    echo "✅ File deleted correctly"
fi
echo ""

# Step 3: Clean everything
echo "3️⃣ Cleaning old builds..."
cd /workspace/client

echo "   Removing node_modules..."
rm -rf node_modules

echo "   Removing dist..."
rm -rf dist

echo "   Removing iOS build cache..."
rm -rf ios/App/App/public
rm -rf ios/App/build
rm -rf ios/App/DerivedData

echo "   Clearing npm cache..."
npm cache clean --force

echo "✅ Clean complete"
echo ""

# Step 4: Fresh install
echo "4️⃣ Installing dependencies..."
npm install
echo ""

# Step 5: Build React app
echo "5️⃣ Building React app..."
npm run build

if [ -f "dist/index.html" ]; then
    echo "✅ Build successful - dist/index.html exists"
else
    echo "❌ Build FAILED - dist/index.html not found"
    exit 1
fi
echo ""

# Step 6: Verify the built files
echo "6️⃣ Verifying built files..."
if grep -q "Connection Point" dist/index.html; then
    echo "✅ Built index.html contains 'Connection Point'"
else
    echo "⚠️  'Connection Point' not found in index.html"
    echo "   Searching in JavaScript bundles..."
    grep -r "Connection Point" dist/assets/*.js | head -1
fi
echo ""

# Step 7: Sync with Capacitor
echo "7️⃣ Syncing with Capacitor..."
npx cap sync ios
echo ""

# Step 8: Open Xcode
echo "8️⃣ Opening Xcode..."
npx cap open ios
echo ""

echo "============================================================"
echo "✅ REBUILD COMPLETE"
echo "============================================================"
echo ""
echo "📋 Next Steps in Xcode:"
echo ""
echo "1. Clean Build Folder:"
echo "   Product → Clean Build Folder (Shift+Cmd+K)"
echo ""
echo "2. Archive:"
echo "   Product → Archive"
echo ""
echo "3. Distribute to TestFlight"
echo ""
echo "4. IMPORTANT: Increment build number!"
echo "   - In Xcode, select App target"
echo "   - Go to General tab"
echo "   - Increment 'Build' number (e.g., 1.0.1 → 1.0.2)"
echo "   - This ensures TestFlight knows it's a new build"
echo ""
echo "============================================================"
