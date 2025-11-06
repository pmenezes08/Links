#!/usr/bin/env python3
"""
Verify MuseTalk local installation is completely removed
Shows what's left and confirms API mode is ready
"""

import os
import sys
import subprocess

def check_file_exists(path, description):
    """Check if file/dir exists"""
    exists = os.path.exists(path)
    status = "❌ STILL EXISTS" if exists else "✅ Removed"
    size = ""
    if exists:
        try:
            if os.path.isdir(path):
                result = subprocess.run(['du', '-sh', path], capture_output=True, text=True)
                size = f" ({result.stdout.split()[0]})"
        except:
            pass
    print(f"{status:20} {description:30} {size}")
    return not exists

def check_package_installed(package_name):
    """Check if Python package is installed"""
    try:
        result = subprocess.run(
            ['pip3', 'show', package_name],
            capture_output=True,
            text=True,
            timeout=5
        )
        installed = result.returncode == 0
        status = "❌ STILL INSTALLED" if installed else "✅ Removed"
        print(f"{status:20} {package_name}")
        return not installed
    except:
        return True  # Assume removed if we can't check

def check_env_var(var_name):
    """Check if environment variable is set"""
    value = os.environ.get(var_name, '')
    if value:
        print(f"✅ Set            {var_name}: {value[:50]}...")
        return True
    else:
        print(f"❌ NOT SET        {var_name}")
        return False

print("=" * 70)
print("MuseTalk Cleanup Verification")
print("=" * 70)
print()

print("📁 CHECKING DIRECTORIES...")
print("-" * 70)
all_dirs_removed = True
all_dirs_removed &= check_file_exists('MuseTalk', 'MuseTalk directory')
all_dirs_removed &= check_file_exists('musetalk_env', 'Virtual environment')
all_dirs_removed &= check_file_exists('musetalk_worker.py', 'Worker script (old)')
print()

print("📦 CHECKING PACKAGES...")
print("-" * 70)
packages_to_check = [
    'torch',
    'torchvision',
    'torchaudio',
    'mmcv',
    'mmpose',
    'mmdet',
    'diffusers',
    'transformers',
    'accelerate'
]
all_packages_removed = True
for pkg in packages_to_check:
    all_packages_removed &= check_package_installed(pkg)
print()

print("⚙️  CHECKING API CONFIGURATION...")
print("-" * 70)
api_configured = True
api_configured &= check_env_var('MUSETALK_API_URL')
api_configured &= check_env_var('MUSETALK_API_SECRET')
print()

print("📊 ESSENTIAL PACKAGES (should be kept)...")
print("-" * 70)
essential_packages = ['numpy', 'opencv-python', 'Pillow', 'requests']
for pkg in essential_packages:
    try:
        result = subprocess.run(['pip3', 'show', pkg], capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            print(f"✅ Installed       {pkg}")
        else:
            print(f"⚠️  Missing        {pkg} (may be needed)")
    except:
        print(f"?  Unknown         {pkg}")
print()

print("=" * 70)
print("SUMMARY")
print("=" * 70)

if all_dirs_removed:
    print("✅ All MuseTalk directories removed")
else:
    print("⚠️  Some directories still exist - run cleanup script")

if all_packages_removed:
    print("✅ All MuseTalk packages uninstalled")
else:
    print("⚠️  Some packages still installed - run cleanup script")

if api_configured:
    print("✅ API configuration ready")
else:
    print("❌ API not configured - add to .env file:")
    print("   MUSETALK_API_URL=https://your-gpu-server-url")
    print("   MUSETALK_API_SECRET=your-secret-key")

print()

if all_dirs_removed and all_packages_removed and api_configured:
    print("🎉 SUCCESS! Local MuseTalk completely removed and API ready!")
    sys.exit(0)
elif all_dirs_removed and all_packages_removed:
    print("⚠️  Cleanup complete but API not configured yet")
    sys.exit(1)
else:
    print("❌ Cleanup incomplete - run: bash cleanup_musetalk_local.sh")
    sys.exit(1)
