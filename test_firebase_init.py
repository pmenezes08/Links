#!/usr/bin/env python3.10
"""Test Firebase initialization on server."""

import sys
import os

sys.path.insert(0, '/home/puntz08/WorkoutX/Links')

# Set the credentials path
os.environ['FIREBASE_CREDENTIALS'] = '/home/puntz08/secrets/cpoint-127c2-firebase-adminsdk-fbsvc-1f900dabeb.json'
os.environ['DB_BACKEND'] = 'mysql'
os.environ['MYSQL_HOST'] = 'puntz08.mysql.pythonanywhere-services.com'
os.environ['MYSQL_DB'] = 'puntz08$C-Point'
os.environ['MYSQL_USER'] = 'puntz08'
os.environ['MYSQL_PASSWORD'] = 'Trying123456'

print("="*60)
print("🔥 Firebase Initialization Test")
print("="*60)

# Check if file exists
creds_file = os.environ['FIREBASE_CREDENTIALS']
if os.path.exists(creds_file):
    print(f"✅ Credentials file exists: {creds_file}")
else:
    print(f"❌ Credentials file NOT found: {creds_file}")
    sys.exit(1)

# Try to initialize
from backend.services.firebase_notifications import initialize_firebase, FIREBASE_AVAILABLE

print(f"\nFirebase Admin SDK available: {FIREBASE_AVAILABLE}")

if FIREBASE_AVAILABLE:
    result = initialize_firebase()
    if result:
        print("✅ Firebase initialized successfully!")
    else:
        print("❌ Firebase initialization failed")
else:
    print("❌ Firebase Admin SDK not installed")
    print("   Run: pip3.10 install --user firebase-admin")

print("="*60)
