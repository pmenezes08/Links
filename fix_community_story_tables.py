#!/usr/bin/env python3
"""
Fix community story tables foreign key constraint issues

This script drops and recreates the community story tables with proper
character set and collation to fix foreign key constraint errors.
"""
import os
import sys

# Add backend to path
sys.path.insert(0, os.path.dirname(__file__))

from backend.services.database import get_db_connection, USE_MYSQL

def main():
    if not USE_MYSQL:
        print("This script is only needed for MySQL databases.")
        print("SQLite doesn't have the same foreign key constraint issues.")
        return
    
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
    except Exception as e:
        print(f"Failed to connect to database: {e}")
        return
    
    try:
        # Check users table username column definition
        print("Checking users.username column definition...")
        cursor.execute("""
            SELECT COLUMN_TYPE, CHARACTER_SET_NAME, COLLATION_NAME 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'users' 
            AND COLUMN_NAME = 'username'
        """)
        users_col = cursor.fetchone()
        if users_col:
            if isinstance(users_col, dict):
                print(f"users.username: TYPE={users_col['COLUMN_TYPE']}, CHARSET={users_col['CHARACTER_SET_NAME']}, COLLATION={users_col['COLLATION_NAME']}")
            else:
                print(f"users.username: TYPE={users_col[0]}, CHARSET={users_col[1]}, COLLATION={users_col[2]}")
        else:
            print("Could not find users.username column")
            return
        
        # Drop existing community story tables if they exist
        print("\nDropping existing community story tables...")
        cursor.execute("DROP TABLE IF EXISTS community_story_reactions")
        cursor.execute("DROP TABLE IF EXISTS community_story_views")
        print("Dropped community_story_reactions and community_story_views tables")
        
        # Check if community_stories table exists
        cursor.execute("SHOW TABLES LIKE 'community_stories'")
        if not cursor.fetchone():
            print("\nCreating community_stories table...")
            cursor.execute("""
                CREATE TABLE community_stories (
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
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
            """)
            print("Created community_stories table")
        
        # Create community_story_views table with explicit charset/collation
        print("\nCreating community_story_views table...")
        cursor.execute("""
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
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
        """)
        print("Created community_story_views table")
        
        # Create community_story_reactions table with explicit charset/collation
        print("\nCreating community_story_reactions table...")
        cursor.execute("""
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
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
        """)
        print("Created community_story_reactions table")
        
        # Commit is not needed with autocommit=True (which is the default in get_db_connection)
        print("\n✓ All community story tables created successfully with proper foreign key constraints")
        
        # Verify the tables
        print("\nVerifying tables...")
        cursor.execute("SHOW TABLES LIKE 'community_story%'")
        tables = cursor.fetchall()
        for table in tables:
            if isinstance(table, dict):
                # DictCursor
                table_name = list(table.values())[0]
                print(f"  - {table_name} exists")
            else:
                print(f"  - {table[0]} exists")
        
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
    finally:
        try:
            cursor.close()
            conn.close()
        except:
            pass

if __name__ == "__main__":
    main()
