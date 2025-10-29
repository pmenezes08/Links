#!/usr/bin/env python3
"""
Diagnostic script to check OpenAI setup on PythonAnywhere
Run this to verify everything is configured correctly
"""
import os
import sys

print("="*60)
print("OpenAI Setup Diagnostic")
print("="*60)
print()

# Check 1: OpenAI package
print("1. Checking OpenAI package...")
try:
    from openai import OpenAI
    print("   ✅ OpenAI package is installed")
except ImportError as e:
    print(f"   ❌ OpenAI package NOT installed: {e}")
    print("   Fix: Run this command in PythonAnywhere bash console:")
    print("   pip install --user openai")
    sys.exit(1)

print()

# Check 2: API Key
print("2. Checking OPENAI_API_KEY environment variable...")
api_key = os.environ.get('OPENAI_API_KEY', '')
if api_key:
    print(f"   ✅ API Key found: {len(api_key)} characters")
    print(f"   Key starts with: {api_key[:15]}...")
else:
    print("   ❌ OPENAI_API_KEY is NOT set or empty")
    print("   Fix: Add to PythonAnywhere WSGI file:")
    print("   os.environ['OPENAI_API_KEY'] = 'sk-proj-YOUR-KEY-HERE'")
    sys.exit(1)

print()

# Check 3: Test OpenAI client
print("3. Testing OpenAI client initialization...")
try:
    client = OpenAI(api_key=api_key)
    print("   ✅ OpenAI client initialized successfully")
except Exception as e:
    print(f"   ❌ Failed to initialize OpenAI client: {e}")
    sys.exit(1)

print()
print("="*60)
print("🎉 SUCCESS! OpenAI is configured correctly!")
print("="*60)
print()
print("Next steps:")
print("1. Reload your web app in PythonAnywhere (green Reload button)")
print("2. Upload an audio post")
print("3. Check error log for transcription messages")
print()
