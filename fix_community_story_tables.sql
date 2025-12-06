-- Fix community story tables with proper foreign key constraints
-- This script drops and recreates the tables with correct character sets and collation
-- The collation utf8mb4_0900_ai_ci matches the users.username column

-- Drop existing tables (in correct order due to foreign key constraints)
DROP TABLE IF EXISTS community_story_reactions;
DROP TABLE IF EXISTS community_story_views;

-- Note: We don't drop community_stories if it has data
-- If community_stories exists with incompatible schema, it needs to be manually migrated

-- Create community_stories table if it doesn't exist
CREATE TABLE IF NOT EXISTS community_stories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    community_id INT NOT NULL,
    username VARCHAR(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
    media_path VARCHAR(512) NOT NULL,
    media_type VARCHAR(16) NOT NULL,
    caption TEXT,
    duration_seconds INT,
    status VARCHAR(32) NOT NULL DEFAULT 'active',
    created_at DATETIME NOT NULL,
    expires_at DATETIME NOT NULL,
    view_count INT NOT NULL DEFAULT 0,
    last_viewed_at DATETIME,
    INDEX idx_cs_comm_expires (community_id, expires_at),
    INDEX idx_cs_user_created (username, created_at),
    CONSTRAINT fk_cs_community FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE,
    CONSTRAINT fk_cs_user FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Create community_story_views table
CREATE TABLE community_story_views (
    id INT AUTO_INCREMENT PRIMARY KEY,
    story_id INT NOT NULL,
    username VARCHAR(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
    viewed_at DATETIME NOT NULL,
    UNIQUE KEY uniq_story_viewer (story_id, username),
    INDEX idx_csv_story (story_id),
    INDEX idx_csv_user (username),
    CONSTRAINT fk_csv_story FOREIGN KEY (story_id) REFERENCES community_stories(id) ON DELETE CASCADE,
    CONSTRAINT fk_csv_user FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Create community_story_reactions table
CREATE TABLE community_story_reactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    story_id INT NOT NULL,
    username VARCHAR(150) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci NOT NULL,
    reaction VARCHAR(16) NOT NULL,
    created_at DATETIME NOT NULL,
    UNIQUE KEY uniq_story_reaction (story_id, username),
    INDEX idx_csr_story (story_id),
    INDEX idx_csr_reaction (reaction),
    CONSTRAINT fk_csr_story FOREIGN KEY (story_id) REFERENCES community_stories(id) ON DELETE CASCADE,
    CONSTRAINT fk_csr_user FOREIGN KEY (username) REFERENCES users(username) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
