#!/usr/bin/env python3
"""Check if push_tokens table exists and show its structure."""

import os
import sys

# Set MySQL env vars if not set
if not os.environ.get('MYSQL_HOST'):
    os.environ['MYSQL_HOST'] = 'puntz08.mysql.pythonanywhere-services.com'
    os.environ['MYSQL_USER'] = 'puntz08'
    os.environ['MYSQL_DB'] = 'puntz08$C-Point'

if not os.environ.get('MYSQL_PASSWORD'):
    print("⚠️  Please set MYSQL_PASSWORD env var")
    print("   export MYSQL_PASSWORD='YourPassword'")
    sys.exit(1)

try:
    import pymysql
    
    conn = pymysql.connect(
        host=os.environ['MYSQL_HOST'],
        user=os.environ['MYSQL_USER'],
        password=os.environ['MYSQL_PASSWORD'],
        database=os.environ['MYSQL_DB']
    )
    
    cursor = conn.cursor()
    
    # Check if table exists
    cursor.execute("SHOW TABLES LIKE 'push_tokens';")
    result = cursor.fetchone()
    
    if result:
        print("✅ push_tokens table exists")
        print("\n📋 Table structure:")
        cursor.execute("DESCRIBE push_tokens;")
        for row in cursor.fetchall():
            print(f"  {row[0]}: {row[1]} {row[2]} {row[3]} {row[4]}")
        
        print("\n📊 Row count:")
        cursor.execute("SELECT COUNT(*) FROM push_tokens;")
        count = cursor.fetchone()[0]
        print(f"  Total rows: {count}")
        
        if count > 0:
            print("\n📱 Recent tokens:")
            cursor.execute("SELECT username, platform, LEFT(token, 30) as token_preview, created_at FROM push_tokens ORDER BY created_at DESC LIMIT 5;")
            for row in cursor.fetchall():
                print(f"  {row[0]} ({row[1]}): {row[2]}... - {row[3]}")
    else:
        print("❌ push_tokens table DOES NOT exist")
        print("\n🔧 Creating table...")
        cursor.execute("""
            CREATE TABLE push_tokens (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(255) NOT NULL,
                token TEXT NOT NULL,
                platform VARCHAR(50) NOT NULL,
                is_active BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_username (username),
                INDEX idx_platform (platform)
            );
        """)
        conn.commit()
        print("✅ Table created successfully")
    
    cursor.close()
    conn.close()
    
except Exception as e:
    print(f"❌ Error: {e}")
    sys.exit(1)
