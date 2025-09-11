#!/bin/bash
# Setup MySQL Environment Variables for PythonAnywhere
# Run this script before starting your Flask app

echo "Setting up MySQL environment variables for PythonAnywhere..."

# Set the database backend to MySQL
export DB_BACKEND=mysql

# Set MySQL connection details for PythonAnywhere
export MYSQL_HOST=puntz08.mysql.pythonanywhere-services.com
export MYSQL_USER=puntz08
export MYSQL_DATABASE='puntz08$C-Point'

# You need to set this yourself with your actual password
if [ -z "$MYSQL_PASSWORD" ]; then
    echo "⚠️  WARNING: MYSQL_PASSWORD is not set!"
    echo "Please set it with: export MYSQL_PASSWORD='your_actual_mysql_password'"
    echo ""
fi

echo "Environment variables set:"
echo "  DB_BACKEND=$DB_BACKEND"
echo "  MYSQL_HOST=$MYSQL_HOST"
echo "  MYSQL_USER=$MYSQL_USER"
echo "  MYSQL_DATABASE=$MYSQL_DATABASE"
echo "  MYSQL_PASSWORD=$(if [ -z "$MYSQL_PASSWORD" ]; then echo "NOT SET"; else echo "SET"; fi)"

echo ""
echo "To make these permanent, add them to your ~/.bashrc:"
echo "echo 'export DB_BACKEND=mysql' >> ~/.bashrc"
echo "echo 'export MYSQL_HOST=puntz08.mysql.pythonanywhere-services.com' >> ~/.bashrc"
echo "echo 'export MYSQL_USER=puntz08' >> ~/.bashrc"
echo "echo 'export MYSQL_DATABASE=\"puntz08\\\$C-Point\"' >> ~/.bashrc"
echo "echo 'export MYSQL_PASSWORD=your_password' >> ~/.bashrc"
echo ""
echo "Then restart your Flask application."