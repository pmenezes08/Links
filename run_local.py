#!/usr/bin/env python3
"""
Local Development Server for Bodybuilding App
This script runs the Flask app in development mode with debug enabled.
"""

import os
import sys
from bodybuilding_app import app

if __name__ == '__main__':
    # Set development environment variables
    os.environ['FLASK_ENV'] = 'development'
    os.environ['FLASK_DEBUG'] = '1'
    
    # Use a different database for local development
    os.environ['LOCAL_DEV'] = '1'
    
    print("🚀 Starting local development server...")
    print("📍 Server will be available at: http://localhost:5000")
    print("🔧 Debug mode: ENABLED")
    print("📁 Local database will be used")
    print("⏹️  Press Ctrl+C to stop the server")
    print("-" * 50)
    
    # Run the Flask app in debug mode
    app.run(
        host='0.0.0.0',
        port=5000,
        debug=True,
        use_reloader=True
    )
