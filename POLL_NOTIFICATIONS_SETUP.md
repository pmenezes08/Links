# Poll Notifications Setup

## Overview
Automated poll notifications system that sends reminders to community members at key milestones.

## Notifications Sent

### 1. **25% Progress** (Non-voters only)
- **Message**: "📊 X community members have voted, go vote on the poll!"
- **Triggers**: When 25-30% of poll lifetime has elapsed

### 2. **50% Progress** (Non-voters only)
- **Message**: "📊 X community members have voted, go vote on the poll!"
- **Triggers**: When 50-55% of poll lifetime has elapsed

### 3. **80% Progress** 
- **Non-voters**: "⏰ The poll is closing in X days, go vote!"
- **Voters**: "📋 Review the poll results before it closes"
- **Triggers**: When 80-85% of poll lifetime has elapsed

### 4. **Poll Closed**
- **Message**: "🔒 Poll results are in! Check them out"
- **Triggers**: When poll owner manually closes the poll (for polls with or without deadline)

## Setup Instructions

### PythonAnywhere Setup (Recommended)

1. **Go to PythonAnywhere Dashboard**
2. **Click "Tasks" tab**
3. **Add a new scheduled task**:
   - **Command**: 
     ```bash
     curl -X POST https://yourapp.pythonanywhere.com/api/poll_notification_check
     ```
   - **Frequency**: Every 1 hour
   - **Time**: :00 (run at the top of each hour)

### Alternative: Manual Cron Job

If hosting on your own server, add to crontab:

```bash
# Check poll notifications every hour
0 * * * * curl -X POST http://localhost:5000/api/poll_notification_check
```

Or use wget:

```bash
0 * * * * wget -qO- http://localhost:5000/api/poll_notification_check
```

## Database Schema

### `poll_notification_log` Table
Tracks sent notifications to prevent duplicates:

```sql
CREATE TABLE poll_notification_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    poll_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    notification_type TEXT NOT NULL,  -- '25', '50', '80_nonvoter', '80_voter', 'closed'
    sent_at TEXT DEFAULT (datetime('now')),
    UNIQUE(poll_id, username, notification_type),
    FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE
)
```

## API Endpoint

### `POST /api/poll_notification_check`

**Description**: Checks all active polls and sends notifications based on progress.

**Authentication**: None required (designed for cron jobs)

**Response**:
```json
{
  "success": true,
  "notifications_sent": 42
}
```

**What it does**:
1. Queries all active polls with `expires_at` dates
2. Calculates time progress (elapsed / total duration)
3. Determines which notifications to send based on progress
4. Checks `poll_notification_log` to avoid duplicates
5. Sends in-app notifications and web push notifications
6. Logs sent notifications

## Testing

### Manual Test
```bash
# Test the endpoint manually
curl -X POST http://localhost:5000/api/poll_notification_check

# Check response
# Should return: {"success": true, "notifications_sent": N}
```

### Create Test Poll
1. Go to a community feed
2. Create a poll with close date in next 2 hours
3. Wait for cron job to run (or trigger manually)
4. Check notifications

## Monitoring

Check Flask logs for:
```
Poll notification check complete: X notifications sent
```

Errors will be logged as:
```
Poll notification check error: <error message>
```

## Notes

- Notifications are sent only ONCE per milestone per user (tracked in `poll_notification_log`)
- Polls without `expires_at` date will NOT trigger 25%/50%/80% notifications
- Polls without deadline will still send "closed" notification when manually closed
- Progress thresholds have 5% windows to account for hourly cron runs:
  - 25% = checks between 0.25-0.30 progress
  - 50% = checks between 0.50-0.55 progress
  - 80% = checks between 0.80-0.85 progress

## Troubleshooting

**Notifications not sending?**
1. Check cron job is running: `crontab -l`
2. Check Flask logs for errors
3. Verify poll has `expires_at` date set
4. Check `poll_notification_log` table for existing entries

**Duplicate notifications?**
1. Should not happen - unique constraint prevents it
2. Check `poll_notification_log` table

**No notifications at 25%/50%?**
1. Ensure cron runs hourly
2. Check poll progress calculation
3. Verify community has members
