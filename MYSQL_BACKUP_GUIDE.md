# 🗄️ MySQL Database Backup Guide for PythonAnywhere

## Quick Backup Methods

---

## ⚡ Method 1: Command Line (Recommended - Fastest)

### In PythonAnywhere Bash Console:

```bash
# Basic backup
mysqldump -u YourUsername -h YourUsername.mysql.pythonanywhere-services.com 'YourUsername$database_name' > backup_$(date +%Y%m%d_%H%M%S).sql

# With password prompt
mysqldump -u YourUsername -p -h YourUsername.mysql.pythonanywhere-services.com 'YourUsername$database_name' > backup_$(date +%Y%m%d_%H%M%S).sql

# Compressed backup (saves space)
mysqldump -u YourUsername -p -h YourUsername.mysql.pythonanywhere-services.com 'YourUsername$database_name' | gzip > backup_$(date +%Y%m%d_%H%M%S).sql.gz
```

**Example:**
```bash
mysqldump -u pmenezes08 -p -h pmenezes08.mysql.pythonanywhere-services.com 'pmenezes08$users' > backup_20231120.sql
```

---

## 📦 Method 2: Python Script (Automated)

Create `backup_database.py`:

```python
#!/usr/bin/env python3
"""
MySQL Database Backup Script for PythonAnywhere
"""

import subprocess
import os
from datetime import datetime

# Configuration - UPDATE THESE
MYSQL_USER = 'YourUsername'
MYSQL_HOST = 'YourUsername.mysql.pythonanywhere-services.com'
MYSQL_DATABASE = 'YourUsername$database_name'
MYSQL_PASSWORD = 'your_password'  # Or use environment variable
BACKUP_DIR = '/home/YourUsername/backups'

def backup_database():
    """Create a timestamped backup of the MySQL database"""
    
    # Create backup directory if it doesn't exist
    os.makedirs(BACKUP_DIR, exist_ok=True)
    
    # Generate timestamp
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    backup_file = f'{BACKUP_DIR}/backup_{timestamp}.sql'
    compressed_file = f'{backup_file}.gz'
    
    print(f"🗄️  Starting MySQL backup...")
    print(f"   Database: {MYSQL_DATABASE}")
    print(f"   Backup file: {backup_file}")
    
    try:
        # Run mysqldump
        cmd = [
            'mysqldump',
            '-u', MYSQL_USER,
            '-h', MYSQL_HOST,
            f'-p{MYSQL_PASSWORD}',  # No space between -p and password
            MYSQL_DATABASE
        ]
        
        # Execute and save to file
        with open(backup_file, 'w') as f:
            result = subprocess.run(cmd, stdout=f, stderr=subprocess.PIPE, text=True)
        
        if result.returncode != 0:
            print(f"❌ Backup failed: {result.stderr}")
            return False
        
        # Get file size
        file_size = os.path.getsize(backup_file)
        file_size_mb = file_size / (1024 * 1024)
        
        print(f"✅ Backup successful!")
        print(f"   Size: {file_size_mb:.2f} MB")
        
        # Compress the backup
        print(f"📦 Compressing backup...")
        compress_cmd = ['gzip', backup_file]
        subprocess.run(compress_cmd)
        
        compressed_size = os.path.getsize(compressed_file)
        compressed_size_mb = compressed_size / (1024 * 1024)
        compression_ratio = (1 - compressed_size / file_size) * 100
        
        print(f"✅ Compression successful!")
        print(f"   Compressed size: {compressed_size_mb:.2f} MB")
        print(f"   Saved: {compression_ratio:.1f}%")
        print(f"   File: {compressed_file}")
        
        # Cleanup old backups (keep last 7 days)
        cleanup_old_backups(BACKUP_DIR, days=7)
        
        return True
        
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

def cleanup_old_backups(backup_dir, days=7):
    """Remove backups older than specified days"""
    import time
    
    print(f"\n🧹 Cleaning up old backups (keeping last {days} days)...")
    
    now = time.time()
    cutoff = now - (days * 86400)  # days in seconds
    
    removed = 0
    for filename in os.listdir(backup_dir):
        if filename.startswith('backup_') and (filename.endswith('.sql') or filename.endswith('.sql.gz')):
            filepath = os.path.join(backup_dir, filename)
            if os.path.getmtime(filepath) < cutoff:
                os.remove(filepath)
                removed += 1
                print(f"   Removed: {filename}")
    
    if removed == 0:
        print(f"   No old backups to remove")
    else:
        print(f"   Removed {removed} old backup(s)")

def list_backups():
    """List all available backups"""
    print(f"\n📋 Available backups in {BACKUP_DIR}:")
    
    if not os.path.exists(BACKUP_DIR):
        print("   No backups found")
        return
    
    backups = []
    for filename in os.listdir(BACKUP_DIR):
        if filename.startswith('backup_'):
            filepath = os.path.join(BACKUP_DIR, filename)
            size = os.path.getsize(filepath) / (1024 * 1024)
            mtime = os.path.getmtime(filepath)
            backups.append((filename, size, mtime))
    
    # Sort by date (newest first)
    backups.sort(key=lambda x: x[2], reverse=True)
    
    if not backups:
        print("   No backups found")
        return
    
    for filename, size, mtime in backups:
        date_str = datetime.fromtimestamp(mtime).strftime('%Y-%m-%d %H:%M:%S')
        print(f"   {filename:40s} {size:8.2f} MB  {date_str}")

if __name__ == '__main__':
    print("=" * 60)
    print("MySQL Database Backup Tool")
    print("=" * 60)
    
    success = backup_database()
    
    if success:
        list_backups()
        print("\n✅ Backup completed successfully!")
    else:
        print("\n❌ Backup failed!")
        exit(1)
```

**Run it:**
```bash
python3 backup_database.py
```

---

## 🔄 Method 3: Scheduled Automatic Backups

### Create a Daily Backup Task on PythonAnywhere:

1. **Go to Tasks tab** on PythonAnywhere
2. **Create a new scheduled task**:
   - **Time**: `03:00` (3 AM daily)
   - **Command**: 
     ```bash
     /home/YourUsername/.local/bin/mysqldump -u YourUsername -pYourPassword -h YourUsername.mysql.pythonanywhere-services.com 'YourUsername$database_name' | gzip > /home/YourUsername/backups/backup_$(date +\%Y\%m\%d).sql.gz
     ```

---

## 📥 Method 4: Download Backup to Your Computer

After creating a backup, download it:

### Option A: From Bash Console
```bash
# Create backup in your home directory
mysqldump -u YourUsername -p -h YourUsername.mysql.pythonanywhere-services.com 'YourUsername$database_name' > ~/backup.sql

# Compress it
gzip ~/backup.sql
```

Then go to **Files tab** → navigate to `/home/YourUsername/` → download `backup.sql.gz`

### Option B: Using wget (from your local machine)
```bash
# First, move backup to web-accessible folder on PythonAnywhere
# Then download via HTTP (if you set up a download endpoint)
```

---

## 🔐 Secure Backup Script (No Password in Code)

Use environment variables or PythonAnywhere's Secrets:

```python
import os
import subprocess
from datetime import datetime

# Get password from environment variable
MYSQL_PASSWORD = os.environ.get('MYSQL_PASSWORD', '')

if not MYSQL_PASSWORD:
    print("❌ Error: MYSQL_PASSWORD environment variable not set!")
    exit(1)

# Rest of backup script...
```

Set the password in your `.bashrc`:
```bash
echo 'export MYSQL_PASSWORD="your_password"' >> ~/.bashrc
source ~/.bashrc
```

---

## 📊 Check Backup File Size & Integrity

```bash
# List backups with sizes
ls -lh ~/backups/

# Check backup integrity (should show no errors)
mysql -u YourUsername -p -h YourUsername.mysql.pythonanywhere-services.com 'YourUsername$test_db' < backup.sql
```

---

## ♻️ Restore from Backup

```bash
# Restore from uncompressed backup
mysql -u YourUsername -p -h YourUsername.mysql.pythonanywhere-services.com 'YourUsername$database_name' < backup.sql

# Restore from compressed backup
gunzip < backup.sql.gz | mysql -u YourUsername -p -h YourUsername.mysql.pythonanywhere-services.com 'YourUsername$database_name'
```

⚠️ **Warning**: This will overwrite your current database!

---

## 📋 Backup Checklist

Before running backups:
- [ ] Know your MySQL username
- [ ] Know your MySQL password
- [ ] Know your database name (format: `username$dbname`)
- [ ] Know your MySQL host (format: `username.mysql.pythonanywhere-services.com`)
- [ ] Have enough disk space (check with `df -h ~`)

---

## 🎯 Best Practices

1. **Backup before making changes**
   - Before applying MySQL optimizations
   - Before major app updates
   - Before schema changes

2. **Keep multiple backups**
   - Daily: Last 7 days
   - Weekly: Last 4 weeks
   - Monthly: Last 6 months

3. **Store backups off-server**
   - Download to your computer
   - Upload to cloud storage (Dropbox, Google Drive, S3)

4. **Test your backups**
   - Periodically restore to a test database
   - Verify data integrity

5. **Compress backups**
   - Use gzip to save space
   - SQL dumps compress very well (often 90%+ reduction)

---

## 🚨 Emergency Backup (Before Performance Changes)

**Do this RIGHT NOW before applying MySQL optimizations:**

```bash
# Quick one-liner backup
mysqldump -u YourUsername -p -h YourUsername.mysql.pythonanywhere-services.com 'YourUsername$database_name' | gzip > ~/backup_before_optimization_$(date +%Y%m%d).sql.gz

# Verify it was created
ls -lh ~/backup_before_optimization_*.sql.gz

# Download it via Files tab for extra safety
```

---

## 📞 Troubleshooting

### "mysqldump: command not found"
```bash
# Use full path
/usr/bin/mysqldump ...
```

### "Access denied for user"
- Check username and password
- Verify database name includes username prefix: `username$dbname`

### "Can't connect to MySQL server"
- Check host name: `username.mysql.pythonanywhere-services.com`
- Verify MySQL is running on PythonAnywhere (Databases tab)

### "Out of disk space"
```bash
# Check disk usage
df -h ~

# Clean up old backups
rm ~/backups/backup_old_*.sql.gz

# Upgrade PythonAnywhere plan if needed
```

---

## ✅ Quick Backup Command (Copy & Paste)

**Replace `YourUsername` and `database_name` with your actual values:**

```bash
mysqldump -u YourUsername -p -h YourUsername.mysql.pythonanywhere-services.com 'YourUsername$database_name' | gzip > ~/backup_$(date +%Y%m%d_%H%M%S).sql.gz && echo "✅ Backup created: ~/backup_$(date +%Y%m%d_%H%M%S).sql.gz"
```

---

Your database is valuable—back it up regularly! 💾
