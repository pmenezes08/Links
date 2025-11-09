-- Fix Mary's Project Management Team ownership
-- She should be admin (not owner) since she lost parent ACME admin rights

-- Step 1: Check current status
SELECT 'Before fix:' as status;
SELECT u.username, c.name as community, uc.role, c.creator_username
FROM user_communities uc
JOIN users u ON uc.user_id = u.id
JOIN communities c ON uc.community_id = c.id
WHERE u.username = 'mary' 
AND c.id IN (85, 56)  -- Project Management Team and ACME Corporation
ORDER BY c.id;

-- Step 2: Demote Mary from owner to admin in Project Management
-- (Since she's not an admin of the parent ACME anymore)
UPDATE user_communities
SET role = 'admin'
WHERE user_id = (SELECT id FROM users WHERE username = 'mary')
AND community_id = 85  -- Project Management Team
AND role = 'owner';

-- Step 3: Verify the fix
SELECT 'After fix:' as status;
SELECT u.username, c.name as community, uc.role, c.creator_username
FROM user_communities uc
JOIN users u ON uc.user_id = u.id  
JOIN communities c ON uc.community_id = c.id
WHERE u.username = 'mary'
AND c.id IN (85, 56)
ORDER BY c.id;

-- Step 4: Also check Paulo's status in ACME (should be admin)
SELECT 'Paulo status:' as status;
SELECT u.username, c.name as community, uc.role
FROM user_communities uc
JOIN users u ON uc.user_id = u.id
JOIN communities c ON uc.community_id = c.id  
WHERE u.username = 'Paulo'
AND c.id = 56;  -- ACME Corporation
