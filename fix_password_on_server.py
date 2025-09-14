#!/usr/bin/env python3
"""
Fix MySQL password directly on PythonAnywhere server
Run this script on PythonAnywhere to fix the password issue
"""

import os

def fix_password_on_server():
    """Fix the MySQL password on the server"""
    print("🔧 Fixing MySQL password on PythonAnywhere server...")
    
    # The correct password
    correct_password = "tHqF#6gTM_XQYbB"
    
    # Create .env file with correct password
    env_content = f"""# MySQL Environment Variables for Links App
MYSQL_HOST=puntz08.mysql.pythonanywhere-services.com
MYSQL_USER=puntz08
MYSQL_PASSWORD={correct_password}
MYSQL_DB=puntz08$C-Point
DB_BACKEND=mysql
"""
    
    try:
        with open('.env', 'w') as f:
            f.write(env_content)
        print("✅ .env file created with correct password!")
        print(f"🔍 Password set to: {correct_password}")
        return True
    except Exception as e:
        print(f"❌ Failed to create .env file: {e}")
        return False

def test_mysql_connection():
    """Test MySQL connection with correct password"""
    print("🔧 Testing MySQL connection...")
    
    try:
        import pymysql
        from pymysql.cursors import DictCursor
        
        # Load environment variables
        from dotenv import load_dotenv
        load_dotenv()
        
        host = os.environ.get('MYSQL_HOST')
        user = os.environ.get('MYSQL_USER')
        password = os.environ.get('MYSQL_PASSWORD')
        database = os.environ.get('MYSQL_DB')
        
        print(f"🔍 Testing connection to: {host}")
        print(f"🔍 Database: {database}")
        print(f"🔍 User: {user}")
        print(f"🔍 Password length: {len(password) if password else 'NOT SET'}")
        
        if not all([host, user, password, database]):
            print("❌ Missing MySQL environment variables")
            return False
        
        # Test connection
        conn = pymysql.connect(
            host=host,
            user=user,
            password=password,
            database=database,
            charset='utf8mb4',
            cursorclass=DictCursor,
        )
        
        cursor = conn.cursor()
        cursor.execute("SELECT 1 as test")
        result = cursor.fetchone()
        
        conn.close()
        
        if result and result['test'] == 1:
            print("✅ MySQL connection successful!")
            return True
        else:
            print("❌ MySQL connection test failed")
            return False
            
    except Exception as e:
        print(f"❌ MySQL connection error: {e}")
        return False

def main():
    """Main function"""
    print("🔧 PythonAnywhere MySQL Password Fix")
    print("=" * 40)
    
    # Fix password
    if not fix_password_on_server():
        print("❌ Failed to fix password")
        return False
    
    # Test connection
    if not test_mysql_connection():
        print("❌ Connection test failed")
        return False
    
    print("\n✅ MySQL password fixed and connection successful!")
    print("🚀 Now restart your Flask app on PythonAnywhere!")
    return True

if __name__ == "__main__":
    try:
        success = main()
        if not success:
            exit(1)
    except Exception as e:
        print(f"❌ Error: {e}")
        exit(1)
