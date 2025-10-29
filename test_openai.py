#!/usr/bin/env python3
"""Test script to verify OpenAI integration"""
import os
import sys

# Get API key from environment
api_key = os.environ.get('OPENAI_API_KEY', '')

print("="*50)
print("OpenAI Integration Test")
print("="*50)
print()

if not api_key:
    print("❌ OPENAI_API_KEY not found in environment!")
    print()
    print("Run this command first:")
    print('export OPENAI_API_KEY="sk-your-key-here"')
    sys.exit(1)

print(f"✅ API Key found: {len(api_key)} characters")
print(f"   Starts with: {api_key[:15]}...")
print()

# Test OpenAI import
try:
    from openai import OpenAI
    print("✅ OpenAI module imported successfully")
except ImportError as e:
    print(f"❌ Failed to import OpenAI: {e}")
    print("   Run: pip install openai==1.12.0")
    sys.exit(1)

# Test client initialization
try:
    client = OpenAI(api_key=api_key)
    print("✅ OpenAI client initialized")
except Exception as e:
    print(f"❌ Failed to initialize client: {e}")
    sys.exit(1)

print()
print("="*50)
print("🎉 SUCCESS! AI transcription is ready!")
print("="*50)
print()
print("Next steps:")
print("1. Make sure Flask app has access to OPENAI_API_KEY")
print("2. Restart your Flask app")
print("3. Upload an audio post to test")
print()
