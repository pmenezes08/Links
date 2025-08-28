@echo off
echo Starting Local Development Server...
echo.
echo Make sure you have:
echo 1. Python installed
echo 2. Dependencies installed (run setup_local_dev.py first)
echo 3. .env.local file configured
echo.
echo Starting server at http://localhost:5000
echo Press Ctrl+C to stop the server
echo.
python run_local.py
pause
