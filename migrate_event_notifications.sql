-- Event Notification System Migration
-- Run this SQL on your production database

-- 1. Add notification_preferences column to calendar_events
ALTER TABLE calendar_events 
ADD COLUMN notification_preferences VARCHAR(50) DEFAULT 'all';

-- 2. Create event_notification_log table
CREATE TABLE IF NOT EXISTS event_notification_log (
    id INT PRIMARY KEY AUTO_INCREMENT,
    event_id INT NOT NULL,
    username VARCHAR(191) NOT NULL,
    notification_type VARCHAR(50) NOT NULL,
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_event_notif (event_id, username, notification_type),
    FOREIGN KEY (event_id) REFERENCES calendar_events(id) ON DELETE CASCADE,
    FOREIGN KEY (username) REFERENCES users(username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. Verify the changes
SELECT 'Migration complete!' as status;
SHOW COLUMNS FROM calendar_events LIKE 'notification_preferences';
SHOW TABLES LIKE 'event_notification_log';
