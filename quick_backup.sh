#!/bin/bash
# Quick MySQL Backup Script for PythonAnywhere
# Usage: ./quick_backup.sh

# Configuration - UPDATE THESE VALUES
MYSQL_USER="YourUsername"
MYSQL_HOST="YourUsername.mysql.pythonanywhere-services.com"
MYSQL_DATABASE="YourUsername\$database_name"
BACKUP_DIR="$HOME/backups"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=================================="
echo "MySQL Database Backup Tool"
echo "=================================="
echo ""

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Generate timestamp
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/backup_$TIMESTAMP.sql"
COMPRESSED_FILE="$BACKUP_FILE.gz"

echo "🗄️  Backing up database..."
echo "   Database: $MYSQL_DATABASE"
echo "   User: $MYSQL_USER"
echo "   Host: $MYSQL_HOST"
echo ""

# Prompt for password
read -sp "   MySQL Password: " MYSQL_PASSWORD
echo ""
echo ""

# Run mysqldump
echo "📦 Creating backup..."
mysqldump -u "$MYSQL_USER" -p"$MYSQL_PASSWORD" -h "$MYSQL_HOST" "$MYSQL_DATABASE" > "$BACKUP_FILE" 2>&1

# Check if backup was successful
if [ $? -eq 0 ]; then
    # Get file size
    FILE_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo -e "${GREEN}✅ Backup created successfully!${NC}"
    echo "   File: $BACKUP_FILE"
    echo "   Size: $FILE_SIZE"
    echo ""
    
    # Compress the backup
    echo "🗜️  Compressing backup..."
    gzip "$BACKUP_FILE"
    
    if [ $? -eq 0 ]; then
        COMPRESSED_SIZE=$(du -h "$COMPRESSED_FILE" | cut -f1)
        echo -e "${GREEN}✅ Compression successful!${NC}"
        echo "   File: $COMPRESSED_FILE"
        echo "   Size: $COMPRESSED_SIZE"
        echo ""
        
        # List all backups
        echo "📋 All backups in $BACKUP_DIR:"
        ls -lh "$BACKUP_DIR"/backup_*.sql.gz 2>/dev/null | awk '{print "   " $9 " - " $5 " - " $6 " " $7 " " $8}'
        echo ""
        echo -e "${GREEN}🎉 Backup completed successfully!${NC}"
        echo ""
        echo "To restore this backup, run:"
        echo "   gunzip < $COMPRESSED_FILE | mysql -u $MYSQL_USER -p -h $MYSQL_HOST '$MYSQL_DATABASE'"
    else
        echo -e "${YELLOW}⚠️  Compression failed, but uncompressed backup is available${NC}"
        echo "   File: $BACKUP_FILE"
    fi
else
    echo -e "${RED}❌ Backup failed!${NC}"
    echo ""
    echo "Common issues:"
    echo "   1. Check username and password"
    echo "   2. Verify database name: $MYSQL_DATABASE"
    echo "   3. Verify host: $MYSQL_HOST"
    exit 1
fi
