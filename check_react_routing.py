#!/usr/bin/env python3
"""
Check React Routing and Build Status
Helps diagnose why React changes aren't taking effect
"""

import os
import sys
from datetime import datetime

def check_react_status():
    """Check React build and routing status"""
    
    print("React Routing & Build Status Check")
    print("=" * 40)
    
    # 1. Check if we're in the right directory
    if not os.path.exists('client/package.json'):
        print("❌ Error: client/package.json not found!")
        print("Make sure you're in the project root directory.")
        return False
    
    print("✅ Found React client directory")
    
    # 2. Check React source files
    print("\n📁 Checking React source files...")
    
    react_files = [
        'client/src/App.tsx',
        'client/src/pages/Messages.tsx', 
        'client/src/pages/ChatThread.tsx'
    ]
    
    for file_path in react_files:
        if os.path.exists(file_path):
            mtime = datetime.fromtimestamp(os.path.getmtime(file_path))
            print(f"   ✅ {file_path} (modified: {mtime})")
        else:
            print(f"   ❌ {file_path} - NOT FOUND")
    
    # 3. Check built files
    print("\n🏗️  Checking built files...")
    
    dist_files = [
        'client/dist/index.html',
        'client/dist/assets/index-BfLpY_l2.js',
        'client/dist/assets/index-RMp3r02D.css'
    ]
    
    for file_path in dist_files:
        if os.path.exists(file_path):
            mtime = datetime.fromtimestamp(os.path.getmtime(file_path))
            print(f"   ✅ {file_path} (built: {mtime})")
        else:
            print(f"   ❌ {file_path} - NOT FOUND")
    
    # 4. Check if source is newer than build
    print("\n⏰ Checking if rebuild is needed...")
    
    try:
        # Get latest source file modification time
        source_times = []
        for root, dirs, files in os.walk('client/src'):
            for file in files:
                if file.endswith(('.tsx', '.ts', '.css')):
                    file_path = os.path.join(root, file)
                    source_times.append(os.path.getmtime(file_path))
        
        latest_source = max(source_times) if source_times else 0
        
        # Get build time
        build_time = 0
        if os.path.exists('client/dist/index.html'):
            build_time = os.path.getmtime('client/dist/index.html')
        
        if latest_source > build_time:
            print("   ❌ Source files are newer than build!")
            print("   🔧 You need to rebuild the React app")
            print("   Run: ./rebuild_react.sh")
            return False
        else:
            print("   ✅ Build is up to date")
    
    except Exception as e:
        print(f"   ⚠️  Could not check build status: {e}")
    
    # 5. Check Flask routing
    print("\n🛣️  Checking Flask routing...")
    
    try:
        # Read the Flask app to check routing
        with open('bodybuilding_app.py', 'r') as f:
            content = f.read()
        
        if '@app.route(\'/user_chat\')' in content:
            print("   ✅ /user_chat route exists in Flask")
        else:
            print("   ❌ /user_chat route not found in Flask")
        
        if 'send_from_directory(dist_dir, \'index.html\')' in content:
            print("   ✅ Flask serves React app for mobile")
        else:
            print("   ❌ Flask not configured to serve React app")
        
        if 'is_mobile = any(k in ua for k in [\'Mobi\', \'Android\', \'iPhone\', \'iPad\'])' in content:
            print("   ✅ Mobile detection logic exists")
        else:
            print("   ❌ Mobile detection logic not found")
            
    except Exception as e:
        print(f"   ❌ Error checking Flask routing: {e}")
    
    # 6. Provide recommendations
    print("\n💡 Recommendations:")
    
    if latest_source > build_time:
        print("1. 🔧 REBUILD REACT APP:")
        print("   cd /home/puntz08/WorkoutX/Links")
        print("   ./rebuild_react.sh")
        print("")
        print("2. 🔄 RESTART FLASK APP")
        print("")
        print("3. 🧹 CLEAR BROWSER CACHE:")
        print("   - Desktop: Ctrl+F5 or Cmd+Shift+R")
        print("   - Mobile: Clear browser cache in settings")
    else:
        print("1. 🧹 CLEAR BROWSER CACHE:")
        print("   Your build is up to date, but browser might be caching old version")
        print("   - Desktop: Ctrl+F5 or Cmd+Shift+R") 
        print("   - Mobile: Clear browser cache in settings")
        print("")
        print("2. 🔄 RESTART FLASK APP:")
        print("   Make sure Flask is serving the latest files")
    
    print("\n📱 Testing:")
    print("- Open browser Developer Tools (F12)")
    print("- Go to Network tab")
    print("- Reload page and check if new assets are loaded")
    print("- Check Console tab for any JavaScript errors")
    
    return True

if __name__ == "__main__":
    success = check_react_status()
    sys.exit(0 if success else 1)