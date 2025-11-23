#!/bin/bash
# Quick script to check if push_tokens table exists

echo "Checking push_tokens table..."
echo ""

# Prompt for MySQL password
read -sp "MySQL Password: " MYSQL_PASSWORD
echo ""
echo ""

mysql -u puntz08 -p"$MYSQL_PASSWORD" -h puntz08.mysql.pythonanywhere-services.com "puntz08\$C-Point" <<EOF
-- Check if table exists
SELECT 
    CASE 
        WHEN COUNT(*) > 0 THEN '✅ push_tokens table EXISTS'
        ELSE '❌ push_tokens table MISSING'
    END as status
FROM information_schema.tables 
WHERE table_schema = 'puntz08\$C-Point' 
AND table_name = 'push_tokens';

-- If exists, show structure
SELECT '
Table Structure:' as '';
DESCRIBE push_tokens;

-- Show row count
SELECT '
Row Count:' as '';
SELECT COUNT(*) as total_tokens FROM push_tokens;

-- Show iOS tokens
SELECT '
iOS Tokens:' as '';
SELECT username, platform, LEFT(token, 20) as token_preview, created_at, is_active 
FROM push_tokens 
WHERE platform = 'ios' 
ORDER BY created_at DESC 
LIMIT 5;
EOF
