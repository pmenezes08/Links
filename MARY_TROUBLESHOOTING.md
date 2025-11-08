# Mary Cannot Create Sub-Community - Troubleshooting Guide

## Quick Checks

### 1. What's the exact error message?
When Mary clicks "Create" for a sub-community, what does the alert say?

Possible errors:
- ❌ `"only premium users can create communities"` → Premium/bypass issue
- ❌ `"Only parent community admins can create Business sub-communities"` → Role not detected
- ❌ `"Permission check failed: {error}"` → SQL error
- ❌ `"please verify your email"` → Email not verified
- ❌ Something else?

---

## Step-by-Step Verification

### Step 1: Verify Mary's Account Setup

**Run in MySQL console:**
```sql
-- Check Mary's account
SELECT username, email, email_verified, subscription, is_active 
FROM users 
WHERE username = 'mary';
```

**Expected result:**
- email_verified: `1` (must be verified)
- subscription: `premium` (you said she has this)
- is_active: `1`

---

### Step 2: Find ACME Corporation ID

**Run in MySQL console:**
```sql
-- Find Business communities
SELECT id, name, type, creator_username 
FROM communities 
WHERE type = 'Business';
```

**Note the ID of ACME Corporation** - we'll need it for next steps.

---

### Step 3: Verify Mary's Role in ACME Corporation

**Run in MySQL console** (replace `ACME_ID` with the actual ID):
```sql
-- Check Mary's membership
SELECT uc.user_id, uc.community_id, uc.role, uc.joined_at, u.username
FROM user_communities uc
JOIN users u ON uc.user_id = u.id
WHERE u.username = 'mary' 
AND uc.community_id = ACME_ID;
```

**Expected result:**
- role: `admin` (this is critical!)

**If NO results:** Mary is not a member! Need to add her first.
**If role is `member`:** Need to change to `admin`

---

### Step 4: How to Make Mary an Admin

**If Mary is NOT in user_communities:**
```sql
-- Add Mary as admin to ACME Corporation
INSERT INTO user_communities (user_id, community_id, role, joined_at)
VALUES (
  (SELECT id FROM users WHERE username = 'mary'),
  ACME_ID,  -- Replace with actual ACME Corporation ID
  'admin',
  NOW()
);
```

**If Mary is a member but not admin:**
```sql
-- Update Mary's role to admin
UPDATE user_communities 
SET role = 'admin'
WHERE user_id = (SELECT id FROM users WHERE username = 'mary')
AND community_id = ACME_ID;  -- Replace with actual ACME Corporation ID
```

---

### Step 5: Verify via Web Interface

**After updating the database:**

1. Have Mary logout and login again (to refresh session)
2. Navigate to ACME Corporation → Communities page
3. Click the "+" button (bottom right)
4. Select "Create Sub-Community"
5. Fill in name and select "Business" type
6. Click Create

**Should work now!** ✅

---

## Alternative: Use the Update Member Role Feature

Instead of SQL, use the UI:

1. Login as `admin` (app admin)
2. Go to ACME Corporation → Members
3. Find Mary in the list
4. Click "Manage" → "Make admin"
5. This will properly set her role to 'admin'

---

## Debug Script Output

If you ran `python3 debug_mary_permissions.py`, paste the output here.

It should show:
```
====================================================
DEBUGGING MARY'S PERMISSIONS
====================================================

1. Checking if user 'mary' exists...
✅ User found: ID=123

2. Looking for Business communities...
✅ Found 1 Business communities:
   - ID: 45, Name: ACME Corporation, Type: Business, Creator: admin

3. Checking mary's role in Business communities...

   Community: ACME Corporation (ID: 45)
   ℹ️  Owner is: admin
   ✅ Role: admin
   ✅ Joined: 2025-11-08 12:00:00
   🎉 mary CAN create sub-communities here!
```

If you see `❌` anywhere, that's the problem!

---

## Common Issues & Fixes

### Issue 1: Mary has role 'member' instead of 'admin'
**Fix:** Run the UPDATE query from Step 4 above

### Issue 2: Mary is not in user_communities at all
**Fix:** Run the INSERT query from Step 4 above

### Issue 3: Email not verified
**Fix:**
```sql
UPDATE users SET email_verified = 1 WHERE username = 'mary';
```

### Issue 4: ACME Corporation type is not exactly 'Business'
**Fix:**
```sql
UPDATE communities SET type = 'Business' WHERE name = 'ACME Corporation';
```

---

## After Fixing

Once Mary's role is properly set to 'admin':

1. Mary logs out and back in
2. Reload your webapp on PythonAnywhere: `touch /var/www/puntz08_pythonanywhere_com_wsgi.py`
3. Mary should now be able to create Business sub-communities ✅

---

## Still Not Working?

**Tell me:**
1. The exact error message in the alert
2. The output from `debug_mary_permissions.py`
3. The result from the SQL queries above

I'll help you fix it!
