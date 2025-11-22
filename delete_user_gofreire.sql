-- Complete User Deletion Script for 'gofreire'
-- Run these commands in MySQL console in order

-- 1. Check what data exists first
SELECT 'User Info:' as step;
SELECT username, email, display_name, created_at FROM users WHERE username = 'gofreire';

SELECT 'Posts:' as step;
SELECT COUNT(*) as count FROM posts WHERE username = 'gofreire';

SELECT 'Replies:' as step;
SELECT COUNT(*) as count FROM replies WHERE username = 'gofreire';

SELECT 'Messages:' as step;
SELECT COUNT(*) as sent FROM messages WHERE sender = 'gofreire'
UNION ALL
SELECT COUNT(*) as received FROM messages WHERE receiver = 'gofreire';

SELECT 'Communities:' as step;
SELECT COUNT(*) as member_of FROM user_communities WHERE user_id IN (SELECT id FROM users WHERE username = 'gofreire');

-- 2. Delete all related data (in correct order to avoid foreign key issues)

-- Delete poll votes FIRST (foreign key constraint)
DELETE FROM poll_votes WHERE username = 'gofreire';

-- Delete reactions by this user
DELETE FROM reactions WHERE username = 'gofreire';

-- Delete replies by this user
DELETE FROM replies WHERE username = 'gofreire';

-- Delete posts by this user
DELETE FROM posts WHERE username = 'gofreire';

-- Delete messages sent or received
DELETE FROM messages WHERE sender = 'gofreire' OR receiver = 'gofreire';

-- Delete community memberships
DELETE FROM user_communities WHERE user_id IN (SELECT id FROM users WHERE username = 'gofreire');

-- Delete notifications for this user
DELETE FROM notifications WHERE user_id IN (SELECT id FROM users WHERE username = 'gofreire');

-- Delete push tokens
DELETE FROM push_tokens WHERE username = 'gofreire';

-- Delete encryption keys (if table exists)
DELETE FROM encryption_keys WHERE username = 'gofreire';

-- Delete calendar event attendees
DELETE FROM event_attendees WHERE username = 'gofreire';

-- Delete task assignments
DELETE FROM task_assignments WHERE username = 'gofreire';

-- Finally, delete the user
DELETE FROM users WHERE username = 'gofreire';

-- 3. Verify deletion
SELECT 'Verification - should return 0 rows:' as step;
SELECT * FROM users WHERE username = 'gofreire';
