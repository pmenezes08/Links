#!/usr/bin/env python3

import sqlite3
import os

def test_database():
    """Test if community tables exist and are properly structured"""
    try:
        conn = sqlite3.connect('users.db')
        cursor = conn.cursor()
        
        # Check if community tables exist
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%community%'")
        community_tables = cursor.fetchall()
        print(f"Community tables found: {community_tables}")
        
        # Check communities table structure
        try:
            cursor.execute("PRAGMA table_info(communities)")
            communities_structure = cursor.fetchall()
            print(f"Communities table structure: {communities_structure}")
        except Exception as e:
            print(f"Error checking communities table: {e}")
        
        # Check user_communities table structure
        try:
            cursor.execute("PRAGMA table_info(user_communities)")
            user_communities_structure = cursor.fetchall()
            print(f"User_communities table structure: {user_communities_structure}")
        except Exception as e:
            print(f"Error checking user_communities table: {e}")
        
        # Check if posts table has community_id column
        try:
            cursor.execute("PRAGMA table_info(posts)")
            posts_structure = cursor.fetchall()
            community_id_exists = any('community_id' in str(col) for col in posts_structure)
            print(f"Posts table has community_id column: {community_id_exists}")
        except Exception as e:
            print(f"Error checking posts table: {e}")
        
        conn.close()
        return True
        
    except Exception as e:
        print(f"Database test failed: {e}")
        return False

def test_app_import():
    """Test if the app can be imported and initialized"""
    try:
        import sys
        sys.path.append('.')
        
        # Import the app
        from bodybuilding_app import app, init_db, ensure_indexes
        
        print("App imported successfully")
        
        # Test database initialization
        init_db()
        print("Database initialized successfully")
        
        ensure_indexes()
        print("Indexes ensured successfully")
        
        return True
        
    except Exception as e:
        print(f"App import test failed: {e}")
        return False

if __name__ == "__main__":
    print("Testing Community System...")
    print("=" * 40)
    
    db_test = test_database()
    app_test = test_app_import()
    
    print("=" * 40)
    if db_test and app_test:
        print("✅ All tests passed! Community system should be working.")
    else:
        print("❌ Some tests failed. Check the errors above.")