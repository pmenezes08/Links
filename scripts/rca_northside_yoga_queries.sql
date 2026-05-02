-- Read-only RCA queries: Northside Yoga / Google sign-in mix-up
-- Run against staging or prod MySQL where the incident occurred.

-- 1) Community and creator
SELECT id, name, creator_username, created_at, parent_community_id
FROM communities
WHERE name LIKE '%Northside%Yoga%' OR name = 'Northside Yoga'
ORDER BY id DESC
LIMIT 5;

-- 2) Replace <creator_username> with value from step 1
-- SELECT username, email, google_id, created_at, email_verified_at
-- FROM users
-- WHERE username = '<creator_username>';

-- 3) Membership: replace <community_id> — if no row for your user, dashboard hides it
-- SELECT u.id, u.username, uc.community_id, uc.role, uc.joined_at
-- FROM user_communities uc
-- JOIN users u ON u.id = uc.user_id
-- WHERE uc.community_id = <community_id>;

-- 4) Map usernames to ids for repairs
-- SELECT id, username, email, google_id, first_name, last_name
-- FROM users WHERE username IN ('<old_user>', '<new_user>');

-- 5) Fix wrong display_name (verify with SELECT first)
-- UPDATE user_profiles SET display_name = 'Correct Full Name' WHERE username = '<username>';
-- Bust Redis key profile:<username> or log in again after deploy (login clears caches).

-- 6) If community was created under old_user but you only sign in as new_user: add membership
-- INSERT IGNORE INTO user_communities (user_id, community_id, role, joined_at)
-- VALUES (<new_user_id>, <community_id>, 'member', NOW());

-- Interpretation:
-- A/D: Old username owns row; google_id updated to new Google sub -> email-based linking.
-- C: creator_username is new but UI showed old -> client cache + Redis profile:{username}.
-- Missing community: creator_username / user_communities does not match the logged-in username.
-- Logs: filter "Google sign-in: linked" vs "created new user" vs "returning user".
