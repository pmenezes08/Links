#!/usr/bin/env python3
"""
Add the AI user account (Steve) to the database.
Run this once to create the AI assistant user.
"""

import os
import sys

# Try to load environment variables from .env file
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

def get_db_connection():
    """Get database connection based on environment."""
    db_backend = os.environ.get('DB_BACKEND', 'sqlite')
    
    if db_backend == 'mysql':
        import mysql.connector
        conn = mysql.connector.connect(
            host=os.environ.get('MYSQL_HOST', 'localhost'),
            user=os.environ.get('MYSQL_USER', 'root'),
            password=os.environ.get('MYSQL_PASSWORD', ''),
            database=os.environ.get('MYSQL_DB', 'cpoint')
        )
        return conn, '%s'
    else:
        import sqlite3
        conn = sqlite3.connect('bodybuilding.db')
        conn.row_factory = sqlite3.Row
        return conn, '?'

def main():
    print("Creating AI user account (Steve)...")
    
    try:
        conn, placeholder = get_db_connection()
        cursor = conn.cursor()
        
        # Check if user already exists
        cursor.execute(f"SELECT id FROM users WHERE username = {placeholder}", ('steve',))
        existing = cursor.fetchone()
        
        if existing:
            user_id = existing[0] if isinstance(existing, tuple) else existing['id']
            print(f"AI user 'steve' already exists with ID: {user_id}")
            return
        
        # Create the AI user
        cursor.execute(f"""
            INSERT INTO users (
                username, 
                first_name, 
                last_name, 
                email, 
                password, 
                subscription,
                email_verified
            ) VALUES (
                {placeholder}, {placeholder}, {placeholder}, {placeholder}, 
                {placeholder}, {placeholder}, {placeholder}
            )
        """, (
            'steve',                      # username
            'Steve',                      # first_name
            '(AI)',                       # last_name - indicates AI
            'steve-ai@c-point.co',        # email (placeholder, not real)
            'AI_ACCOUNT_NO_LOGIN',        # password (cannot login)
            'system',                     # subscription type marks as system account
            1                             # email_verified
        ))
        
        conn.commit()
        
        # Get the new user's ID
        cursor.execute(f"SELECT id FROM users WHERE username = {placeholder}", ('steve',))
        new_user = cursor.fetchone()
        user_id = new_user[0] if isinstance(new_user, tuple) else new_user['id']
        
        print(f"Successfully created AI user 'steve' with ID: {user_id}")
        print("\nSteve is ready to help in the community!")
        
        conn.close()
        
    except Exception as e:
        print(f"Error creating AI user: {e}")
        sys.exit(1)

if __name__ == '__main__':
    main()
