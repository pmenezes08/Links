#!/usr/bin/env python3
"""
Local Development Setup Script
This script sets up the local development environment for the Bodybuilding App.
"""

import os
import sys
import subprocess
import shutil
from pathlib import Path

def run_command(command, description):
    """Run a command and handle errors."""
    print(f"🔄 {description}...")
    try:
        result = subprocess.run(command, shell=True, check=True, capture_output=True, text=True)
        print(f"✅ {description} completed successfully")
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ {description} failed: {e}")
        print(f"Error output: {e.stderr}")
        return False

def setup_local_environment():
    """Set up the local development environment."""
    print("🚀 Setting up local development environment...")
    print("=" * 50)
    
    # Check if Python is available
    if not run_command("python --version", "Checking Python installation"):
        print("❌ Python is not available. Please install Python 3.7+")
        return False
    
    # Install dependencies
    if not run_command("pip install -r requirements.txt", "Installing Python dependencies"):
        print("❌ Failed to install dependencies")
        return False
    
    # Create .env.local file if it doesn't exist
    env_file = Path(".env.local")
    env_example = Path("env.local.example")
    
    if not env_file.exists() and env_example.exists():
        print("📝 Creating .env.local file from template...")
        shutil.copy(env_example, env_file)
        print("✅ Created .env.local file")
        print("⚠️  Please edit .env.local and add your API keys")
    elif env_file.exists():
        print("✅ .env.local file already exists")
    else:
        print("⚠️  No .env.local file found. Please create one manually.")
    
    # Initialize local database
    print("🗄️  Initializing local database...")
    os.environ['LOCAL_DEV'] = '1'
    
    try:
        # Import and run database initialization
        from init_database import init_database
        init_database()
        print("✅ Local database initialized successfully")
    except Exception as e:
        print(f"❌ Failed to initialize database: {e}")
        return False
    
    print("\n" + "=" * 50)
    print("🎉 Local development environment setup complete!")
    print("\n📋 Next steps:")
    print("1. Edit .env.local and add your API keys")
    print("2. Run: python run_local.py")
    print("3. Open http://localhost:5000 in your browser")
    print("\n🔄 To start development server:")
    print("   python run_local.py")
    print("\n📝 To commit changes to GitHub:")
    print("   git add .")
    print("   git commit -m 'Your commit message'")
    print("   git push origin main")
    
    return True

if __name__ == '__main__':
    setup_local_environment()
