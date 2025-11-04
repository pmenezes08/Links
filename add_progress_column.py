#!/usr/bin/env python3
"""
Migration script to add progress column to imagine_jobs table
Run this on PythonAnywhere: python3 add_progress_column.py
"""

import os
import sys

# Check if running on PythonAnywhere
if os.path.exists('/home/puntz08'):
    sys.path.insert(0, '/home/puntz08/dev/Links')
    os.chdir('/home/puntz08/dev/Links')

from bodybuilding_app import get_db_connection, USE_MYSQL

def add_progress_column():
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            if USE_MYSQL:
                sql = "ALTER TABLE imagine_jobs ADD COLUMN progress INT DEFAULT 0"
            else:
                sql = "ALTER TABLE imagine_jobs ADD COLUMN progress INTEGER DEFAULT 0"
            
            try:
                c.execute(sql)
                conn.commit()
                print("? Added progress column to imagine_jobs table")
            except Exception as e:
                if 'duplicate column' in str(e).lower() or 'already exists' in str(e).lower():
                    print("??  Progress column already exists")
                else:
                    raise
                    
    except Exception as e:
        print(f"? Error: {e}")
        sys.exit(1)

if __name__ == '__main__':
    print("Adding progress column to imagine_jobs table...")
    add_progress_column()
    print("Done!")
