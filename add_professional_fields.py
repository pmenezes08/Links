#!/usr/bin/env python3
"""Add professional fields to users table"""

import sqlite3
import os

def add_professional_fields():
    """Add professional fields to the users table"""
    
    db_path = os.path.join(os.path.dirname(__file__), 'users.db')
    
    try:
        with sqlite3.connect(db_path) as conn:
            c = conn.cursor()
            
            # Check which columns already exist
            c.execute("PRAGMA table_info(users)")
            existing_columns = [col[1] for col in c.fetchall()]
            
            # List of new columns to add
            new_columns = [
                ('role', 'TEXT'),
                ('company', 'TEXT'),
                ('degree', 'TEXT'),
                ('school', 'TEXT'),
                ('skills', 'TEXT'),
                ('linkedin', 'TEXT'),
                ('experience', 'INTEGER')
            ]
            
            # Add columns that don't exist
            for column_name, column_type in new_columns:
                if column_name not in existing_columns:
                    try:
                        c.execute(f"ALTER TABLE users ADD COLUMN {column_name} {column_type}")
                        print(f"✅ Added column: {column_name}")
                    except sqlite3.OperationalError as e:
                        if "duplicate column name" in str(e).lower():
                            print(f"⚠️  Column {column_name} already exists")
                        else:
                            raise
                else:
                    print(f"⚠️  Column {column_name} already exists")
            
            conn.commit()
            print("\n✅ Professional fields migration completed successfully!")
            
            # Show updated table structure
            c.execute("PRAGMA table_info(users)")
            columns = c.fetchall()
            print("\n📋 Updated users table structure:")
            for col in columns:
                print(f"  - {col[1]} ({col[2]})")
                
    except sqlite3.Error as e:
        print(f"❌ Database error: {e}")
    except Exception as e:
        print(f"❌ Unexpected error: {e}")

if __name__ == "__main__":
    add_professional_fields()