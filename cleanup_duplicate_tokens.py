#!/usr/bin/env python3
"""
One-time script to clean up duplicate push tokens in the database.
Run this directly on the server: python3 cleanup_duplicate_tokens.py
"""

import os
import sys

# Load environment variables (optional)
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    # dotenv not installed, try to load .env manually
    env_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
    if os.path.exists(env_file):
        with open(env_file) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    os.environ.setdefault(key.strip(), value.strip())

def cleanup_tokens():
    """Clean up duplicate push tokens, keeping only the most recent per user/platform."""
    
    # Import database utilities
    try:
        from backend.services.database import get_db_connection, get_sql_placeholder, USE_MYSQL
    except ImportError:
        # Fallback for direct script execution
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from backend.services.database import get_db_connection, get_sql_placeholder, USE_MYSQL
    
    print("🔧 Cleaning up duplicate push tokens...")
    print(f"   Database type: {'MySQL' if USE_MYSQL else 'SQLite'}")
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # First, count how many tokens we have
        cursor.execute("SELECT COUNT(*) FROM fcm_tokens WHERE is_active = 1")
        total_active = cursor.fetchone()[0]
        print(f"   Total active tokens: {total_active}")
        
        # Count unique user/platform combinations
        cursor.execute("SELECT COUNT(DISTINCT CONCAT(IFNULL(username,''), '-', platform)) FROM fcm_tokens WHERE is_active = 1" if USE_MYSQL else 
                      "SELECT COUNT(DISTINCT COALESCE(username,'') || '-' || platform) FROM fcm_tokens WHERE is_active = 1")
        unique_combos = cursor.fetchone()[0]
        print(f"   Unique user/platform combinations: {unique_combos}")
        print(f"   Potential duplicates: {total_active - unique_combos}")
        
        if total_active == unique_combos:
            print("✅ No duplicates found!")
            cursor.close()
            conn.close()
            return
        
        # Deactivate older tokens (keep only the most recent per user/platform)
        if USE_MYSQL:
            # MySQL: Use subquery to find tokens to deactivate
            cursor.execute("""
                UPDATE fcm_tokens t1
                JOIN (
                    SELECT username, platform, MAX(last_seen) as max_seen
                    FROM fcm_tokens
                    WHERE is_active = 1
                    GROUP BY username, platform
                ) t2 ON COALESCE(t1.username, '') = COALESCE(t2.username, '') 
                    AND t1.platform = t2.platform
                SET t1.is_active = 0
                WHERE t1.is_active = 1 AND t1.last_seen < t2.max_seen
            """)
            deactivated = cursor.rowcount
        else:
            # SQLite: Use NOT IN with subquery
            cursor.execute("""
                UPDATE fcm_tokens
                SET is_active = 0
                WHERE rowid NOT IN (
                    SELECT MAX(rowid)
                    FROM fcm_tokens
                    WHERE is_active = 1
                    GROUP BY COALESCE(username, ''), platform
                )
                AND is_active = 1
            """)
            deactivated = cursor.rowcount
        
        conn.commit()
        
        # Verify the cleanup
        cursor.execute("SELECT COUNT(*) FROM fcm_tokens WHERE is_active = 1")
        remaining = cursor.fetchone()[0]
        
        print(f"✅ Deactivated {deactivated} duplicate tokens")
        print(f"   Remaining active tokens: {remaining}")
        
        # Also clean up native_push_tokens if it exists
        try:
            cursor.execute("SELECT COUNT(*) FROM native_push_tokens WHERE is_active = 1")
            native_total = cursor.fetchone()[0]
            
            if native_total > 0:
                print(f"\n🔧 Cleaning up native_push_tokens...")
                print(f"   Total active native tokens: {native_total}")
                
                if USE_MYSQL:
                    cursor.execute("""
                        UPDATE native_push_tokens t1
                        JOIN (
                            SELECT username, platform, MAX(last_seen) as max_seen
                            FROM native_push_tokens
                            WHERE is_active = 1
                            GROUP BY username, platform
                        ) t2 ON COALESCE(t1.username, '') = COALESCE(t2.username, '') 
                            AND t1.platform = t2.platform
                        SET t1.is_active = 0
                        WHERE t1.is_active = 1 AND t1.last_seen < t2.max_seen
                    """)
                else:
                    cursor.execute("""
                        UPDATE native_push_tokens
                        SET is_active = 0
                        WHERE rowid NOT IN (
                            SELECT MAX(rowid)
                            FROM native_push_tokens
                            WHERE is_active = 1
                            GROUP BY COALESCE(username, ''), platform
                        )
                        AND is_active = 1
                    """)
                
                native_deactivated = cursor.rowcount
                conn.commit()
                print(f"✅ Deactivated {native_deactivated} duplicate native tokens")
        except Exception as e:
            print(f"   (native_push_tokens table not found or error: {e})")
        
        cursor.close()
        conn.close()
        
        print("\n✅ Cleanup complete!")
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return 1
    
    return 0

if __name__ == "__main__":
    sys.exit(cleanup_tokens())
