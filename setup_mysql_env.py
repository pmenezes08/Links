#!/usr/bin/env python3
"""
Setup MySQL Environment Variables for PythonAnywhere
This script helps configure the MySQL connection for your Links app
Run this on PythonAnywhere bash console
"""

import os

def setup_mysql_env():
    """Set up MySQL environment variables"""

    print("🔧 MySQL Environment Setup for PythonAnywhere")
    print("=" * 50)

    print("This will help you set up the MySQL environment variables")
    print("needed for your Links app to connect to the database.\n")

    # PythonAnywhere MySQL defaults
    defaults = {
        'MYSQL_HOST': 'puntz08.mysql.pythonanywhere-services.com',
        'MYSQL_USER': 'puntz08',
        'MYSQL_DB': 'puntz08$C-Point',
        'DB_BACKEND': 'mysql'
    }

    print("📋 Based on your setup, these are the required environment variables:")
    print(f"   MYSQL_HOST={defaults['MYSQL_HOST']}")
    print(f"   MYSQL_USER={defaults['MYSQL_USER']}")
    print(f"   MYSQL_DB={defaults['MYSQL_DB']}")
    print(f"   DB_BACKEND={defaults['DB_BACKEND']}")
    print("   MYSQL_PASSWORD=•••••••••••••• (your MySQL password)")
    print()

    print("🔑 Please enter your MySQL password:")
    mysql_password = input().strip()

    if not mysql_password:
        print("❌ MySQL password is required!")
        return False

    print("\n📝 Creating environment file...")

    # Create .env file with the variables
    env_content = f"""# MySQL Environment Variables for Links App
MYSQL_HOST={defaults['MYSQL_HOST']}
MYSQL_USER={defaults['MYSQL_USER']}
MYSQL_PASSWORD={mysql_password}
MYSQL_DB={defaults['MYSQL_DB']}
DB_BACKEND={defaults['DB_BACKEND']}
"""

    try:
        with open('.env', 'w') as f:
            f.write(env_content)

        print("✅ .env file created successfully!")
        print("   File: .env")
        print("   Location:", os.path.abspath('.env'))

    except Exception as e:
        print(f"❌ Failed to create .env file: {e}")
        return False

    print("\n🚀 Next Steps:")
    print("1. Your .env file is ready")
    print("2. Restart your Flask app on PythonAnywhere")
    print("3. The app should now connect to MySQL")
    print("4. Check your website - posts, communities, and avatars should appear")

    print("\n💡 If the app still doesn't work:")
    print("   - Check PythonAnywhere 'Web' tab → 'Environment variables'")
    print("   - Make sure the variables are set there too")
    print("   - Or load the .env file in your WSGI file")

    print("\n" + "=" * 50)
    print("🎉 ENVIRONMENT SETUP COMPLETE!")
    print("Restart your Flask app and test the website.")
    print("=" * 50)

    return True

if __name__ == "__main__":
    try:
        success = setup_mysql_env()
        if success:
            print("\n✅ Setup completed successfully!")
        else:
            print("\n❌ Setup failed!")
            exit(1)
    except KeyboardInterrupt:
        print("\n❌ Setup cancelled by user")
        exit(1)
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")
        exit(1)
