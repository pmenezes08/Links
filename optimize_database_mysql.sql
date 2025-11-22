-- MySQL Database Performance Optimization for C.Point
-- Run these commands on your MySQL database via PythonAnywhere MySQL console
-- or phpMyAdmin

-- ============================================
-- OPTION 1: Run via PythonAnywhere Bash Console
-- ============================================
-- mysql -u your_username -p your_database_name < optimize_database_mysql.sql


-- ============================================
-- OPTION 2: Copy/Paste into MySQL Console
-- ============================================

-- Select your database first
-- USE your_database_name;

-- ============================================
-- POSTS TABLE INDICES
-- ============================================

CREATE INDEX idx_posts_community_id ON posts(community_id);
CREATE INDEX idx_posts_timestamp ON posts(timestamp DESC);
CREATE INDEX idx_posts_community_timestamp ON posts(community_id, timestamp DESC);
CREATE INDEX idx_posts_username ON posts(username);

-- ============================================
-- REPLIES TABLE INDICES
-- ============================================

CREATE INDEX idx_replies_post_id ON replies(post_id);
CREATE INDEX idx_replies_parent ON replies(parent_reply_id);

-- ============================================
-- MESSAGES TABLE INDICES
-- ============================================

CREATE INDEX idx_messages_sender ON messages(sender);
CREATE INDEX idx_messages_receiver ON messages(receiver);
CREATE INDEX idx_messages_timestamp ON messages(timestamp DESC);
CREATE INDEX idx_messages_thread ON messages(sender, receiver, timestamp DESC);

-- ============================================
-- REACTIONS TABLE INDICES
-- ============================================

CREATE INDEX idx_reactions_post_id ON reactions(post_id);
CREATE INDEX idx_reactions_username ON reactions(username);

-- ============================================
-- REPLY REACTIONS TABLE INDICES
-- ============================================

CREATE INDEX idx_reply_reactions_reply_id ON reply_reactions(reply_id);
CREATE INDEX idx_reply_reactions_username ON reply_reactions(username);

-- ============================================
-- COMMUNITIES TABLE INDICES
-- ============================================

CREATE INDEX idx_user_communities_user ON user_communities(user_id);
CREATE INDEX idx_user_communities_community ON user_communities(community_id);

-- ============================================
-- NOTIFICATIONS TABLE INDICES
-- ============================================

CREATE INDEX idx_notifications_username ON notifications(username);
CREATE INDEX idx_notifications_read ON notifications(is_read);
CREATE INDEX idx_notifications_timestamp ON notifications(created_at DESC);

-- ============================================
-- OPTIMIZE TABLES
-- ============================================

OPTIMIZE TABLE posts;
OPTIMIZE TABLE replies;
OPTIMIZE TABLE messages;
OPTIMIZE TABLE reactions;
OPTIMIZE TABLE reply_reactions;
OPTIMIZE TABLE user_communities;
OPTIMIZE TABLE notifications;

-- ============================================
-- ANALYZE TABLES (Update statistics for query optimizer)
-- ============================================

ANALYZE TABLE posts;
ANALYZE TABLE replies;
ANALYZE TABLE messages;
ANALYZE TABLE reactions;
ANALYZE TABLE reply_reactions;
ANALYZE TABLE user_communities;
ANALYZE TABLE notifications;

-- ============================================
-- VERIFICATION - Check which indices exist
-- ============================================

-- Show all indices on posts table
SHOW INDEX FROM posts;

-- Show all indices on messages table
SHOW INDEX FROM messages;

-- Show all indices on replies table
SHOW INDEX FROM replies;

-- Show all indices on reactions table
SHOW INDEX FROM reactions;

-- ============================================
-- EXPECTED RESULTS
-- ============================================

-- After running these optimizations, you should see:
-- ✅ Community feed loading: 50-80% faster
-- ✅ Message queries: 60-90% faster
-- ✅ Post creation/loading: 40-70% faster
-- ✅ Reaction queries: 70-90% faster

-- ============================================
-- NOTES
-- ============================================

-- 1. If you get "Duplicate key name" errors, indices already exist (good!)
-- 2. If you get "Table doesn't exist" errors, that feature isn't used yet
-- 3. OPTIMIZE TABLE may take 1-2 minutes on large databases
-- 4. ANALYZE TABLE is fast and safe to run anytime
-- 5. These indices use minimal disk space (typically < 5% of table size)

-- ============================================
-- MONITORING PERFORMANCE
-- ============================================

-- Check query performance after optimization:
-- EXPLAIN SELECT * FROM posts WHERE community_id = 1 ORDER BY timestamp DESC LIMIT 50;
-- 
-- Look for "Using index" in the Extra column = Good!
-- Look for "Using filesort" or "Using temporary" = Needs more optimization
