#!/usr/bin/env python3.10
import sys
import os

sys.path.insert(0, '/home/puntz08/WorkoutX/Links')

os.environ['FIREBASE_CREDENTIALS'] = '/home/puntz08/secrets/cpoint-127c2-firebase-adminsdk-fbsvc-1f900dabeb.json'
os.environ['DB_BACKEND'] = 'mysql'
os.environ['MYSQL_HOST'] = 'puntz08.mysql.pythonanywhere-services.com'
os.environ['MYSQL_DB'] = 'puntz08$C-Point'
os.environ['MYSQL_USER'] = 'puntz08'
os.environ['MYSQL_PASSWORD'] = 'Trying123456'

print("1. Checking Firebase Admin SDK...")
try:
    import firebase_admin
    print(f"   ✅ firebase_admin imported: {firebase_admin.__file__}")
except Exception as e:
    print(f"   ❌ Import failed: {e}")
    sys.exit(1)

print("\n2. Checking credentials file...")
creds_path = os.environ['FIREBASE_CREDENTIALS']
if os.path.exists(creds_path):
    print(f"   ✅ File exists: {creds_path}")
    print(f"   File size: {os.path.getsize(creds_path)} bytes")
else:
    print(f"   ❌ File NOT found: {creds_path}")
    sys.exit(1)

print("\n3. Testing Firebase initialization with detailed errors...")
try:
    from firebase_admin import credentials
    cred = credentials.Certificate(creds_path)
    print("   ✅ Credentials loaded")
    
    firebase_admin.initialize_app(cred)
    print("   ✅ Firebase initialized!")
except Exception as e:
    print(f"   ❌ Initialization failed: {e}")
    import traceback
    traceback.print_exc()

print("\n4. Testing our service module...")
from backend.services.firebase_notifications import initialize_firebase, FIREBASE_AVAILABLE

print(f"   FIREBASE_AVAILABLE: {FIREBASE_AVAILABLE}")
result = initialize_firebase()
print(f"   initialize_firebase() returned: {result}")
