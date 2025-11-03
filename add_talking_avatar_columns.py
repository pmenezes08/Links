#!/usr/bin/env python3
"""Add source_type and audio_path columns to imagine_jobs table for talking avatar feature"""

import sys
import os

# Add current directory to path to import bodybuilding_app
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from bodybuilding_app import get_db_connection, USE_MYSQL

def main():
    try:
        print("\n=== Adding columns to imagine_jobs table ===\n")
        
        with get_db_connection() as conn:
            cursor = conn.cursor()
            
            # Check if columns already exist
            if USE_MYSQL:
                cursor.execute("SHOW COLUMNS FROM imagine_jobs LIKE 'source_type'")
                has_source_type = cursor.fetchone() is not None
                
                cursor.execute("SHOW COLUMNS FROM imagine_jobs LIKE 'audio_path'")
                has_audio_path = cursor.fetchone() is not None
            else:
                cursor.execute("PRAGMA table_info(imagine_jobs)")
                columns = [row[1] for row in cursor.fetchall()]
                has_source_type = 'source_type' in columns
                has_audio_path = 'audio_path' in columns
            
            # Add source_type column if missing
            if not has_source_type:
                print("Adding source_type column...")
                if USE_MYSQL:
                    cursor.execute("""
                        ALTER TABLE imagine_jobs 
                        ADD COLUMN source_type VARCHAR(50) NULL 
                        COMMENT 'Type of source: image, talking_avatar, etc.'
                    """)
                else:
                    cursor.execute("ALTER TABLE imagine_jobs ADD COLUMN source_type TEXT")
                print("✓ source_type column added")
            else:
                print("✓ source_type column already exists")
            
            # Add audio_path column if missing
            if not has_audio_path:
                print("Adding audio_path column...")
                if USE_MYSQL:
                    cursor.execute("""
                        ALTER TABLE imagine_jobs 
                        ADD COLUMN audio_path VARCHAR(512) NULL 
                        COMMENT 'Path to audio file for talking avatar jobs'
                    """)
                else:
                    cursor.execute("ALTER TABLE imagine_jobs ADD COLUMN audio_path TEXT")
                print("✓ audio_path column added")
            else:
                print("✓ audio_path column already exists")
            
            conn.commit()
            
            # Show updated schema
            print("\n=== Updated imagine_jobs schema ===")
            if USE_MYSQL:
                cursor.execute("DESCRIBE imagine_jobs")
            else:
                cursor.execute("PRAGMA table_info(imagine_jobs)")
            
            for row in cursor.fetchall():
                print(row)
        
        print("\n✅ Database migration completed successfully!")
        
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == '__main__':
    main()
