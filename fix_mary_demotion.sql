-- Fix Mary's and Paulo's roles for proper hierarchy access
-- Run this in MySQL console

-- ========================================
-- STEP 1: Fix NULL roles for creators
-- ========================================
SELECT '=== Fixing NULL roles for creators ===' as step;

-- Fix Mary's NULL roles (she owns Project Management and Girly girls)
UPDATE user_communities
SET role = 'admin'  -- Set to admin, not owner (she lost parent ACME admin)
WHERE user_id = (SELECT id FROM users WHERE username = 'mary')
AND community_id = 85  -- Project Management Team
AND role IS NULL;

UPDATE user_communities
SET role = 'owner'
WHERE user_id = (SELECT id FROM users WHERE username = 'mary')
AND community_id = 37  -- Girly girls (she can be owner of this one)
AND role IS NULL;

-- Fix Pingo Doce role (if Mary needs access)
UPDATE user_communities
SET role = 'member'
WHERE user_id = (SELECT id FROM users WHERE username = 'mary')
AND community_id = 89  -- Pingo Doce
AND role IS NULL;

-- ========================================
-- STEP 2: Ensure Paulo is admin of ACME
-- ========================================
SELECT '=== Checking Paulo ACME admin status ===' as step;

-- Check if Paulo is admin of ACME Corporation
SELECT u.username, c.name, uc.role
FROM user_communities uc
JOIN users u ON uc.user_id = u.id
JOIN communities c ON uc.community_id = c.id
WHERE u.username = 'Paulo' AND c.id = 56;

-- If Paulo is not admin, run this:
-- UPDATE user_communities
-- SET role = 'admin'
-- WHERE user_id = (SELECT id FROM users WHERE username = 'Paulo')
-- AND community_id = 56;

-- ========================================
-- STEP 3: Verify the fixes
-- ========================================
SELECT '=== Verification Results ===' as step;

SELECT 
    u.username, 
    c.name as community,
    c.id,
    uc.role,
    c.creator_username,
    c.parent_community_id
FROM user_communities uc
JOIN users u ON uc.user_id = u.id
JOIN communities c ON uc.community_id = c.id
WHERE u.username IN ('mary', 'Paulo')
ORDER BY u.username, c.parent_community_id, c.id;
