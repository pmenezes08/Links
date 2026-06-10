#!/usr/bin/env python3
"""
Create .env file with correct MySQL password
"""

def create_env_file():
    """Create .env file with correct MySQL configuration"""
    print("🔧 Creating .env file with correct MySQL password...")
    
    env_content = """# MySQL Environment Variables for Links App
MYSQL_HOST=YOUR_CLOUD_SQL_HOST
MYSQL_USER=puntz08
MYSQL_PASSWORD=tHqF#6gTM_XQYbB
MYSQL_DB=puntz08$C-Point
DB_BACKEND=mysql
"""
    
    try:
        with open('.env', 'w') as f:
            f.write(env_content)
        print("✅ .env file created successfully with correct password!")
        return True
    except Exception as e:
        print(f"❌ Failed to create .env file: {e}")
        return False

if __name__ == "__main__":
    create_env_file()
