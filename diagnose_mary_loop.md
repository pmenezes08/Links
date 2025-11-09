# Diagnose Mary's Infinite Loop Issue

## Steps to Debug:

### 1. Check Server Logs
```bash
# On your server
tail -100 /var/log/puntz08.pythonanywhere.com.error.log | grep -i "mary\|circular\|duplicate"
```

### 2. Check Browser Console
When Mary tries to navigate, press F12 → Console tab and look for:
- Infinite requests
- React rendering errors
- JavaScript errors

### 3. Run Fix Script
```bash
cd ~/WorkoutX/Links
python3 fix_mary_access.py
```

This will:
- Show all communities Mary owns
- Add her to all parent communities
- Fix missing memberships

### 4. Check Mary's Memberships in Database
```sql
-- Get Mary's user ID
SELECT id FROM users WHERE username = 'mary';

-- Check all communities Mary is a member of
SELECT c.id, c.name, c.parent_community_id, uc.role
FROM user_communities uc
JOIN communities c ON uc.community_id = c.id
WHERE uc.user_id = (SELECT id FROM users WHERE username = 'mary')
ORDER BY c.parent_community_id, c.id;

-- Check what Mary owns
SELECT id, name, parent_community_id 
FROM communities 
WHERE creator_username = 'mary';
```

### 5. Possible Fixes

**Option A: Add Mary to ACME Corporation**
```sql
-- If Mary is NOT a member of ACME Corporation (ID 56)
INSERT INTO user_communities (user_id, community_id, role, joined_at)
VALUES (
  (SELECT id FROM users WHERE username = 'mary'),
  56,
  'member',
  NOW()
);
```

**Option B: Transfer Ownership**
If Project Management should belong to someone else:
```sql
UPDATE communities 
SET creator_username = 'admin' 
WHERE name = 'Project Management Team';
```

## What to Check in Browser

When Mary clicks on Project Management or its nested communities:

1. **Does the page keep reloading?**
2. **Does it redirect back and forth between pages?**
3. **Does the browser freeze?**
4. **What URL is shown in the address bar?**

## Temporary Workaround

Until we fix the root cause, Mary can:
1. Use direct URL: `www.c-point.co/community_feed_react/PROJECT_MGMT_ID`
2. Bypass the communities list page
