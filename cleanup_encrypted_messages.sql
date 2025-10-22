-- Clean up problematic encrypted messages that can't be decrypted
-- Run this on your database to remove messages 2048, 2049, 2050, 2051

-- Check which messages are encrypted
SELECT id, sender, receiver, is_encrypted, 
       SUBSTR(message, 1, 50) as message_preview,
       SUBSTR(encrypted_body, 1, 50) as encrypted_preview
FROM messages 
WHERE is_encrypted = 1
ORDER BY id DESC;

-- Delete the specific problematic messages
DELETE FROM messages WHERE id IN (2048, 2049, 2050, 2051);

-- Or delete ALL encrypted messages to start completely fresh:
-- DELETE FROM messages WHERE is_encrypted = 1;

-- Verify cleanup
SELECT COUNT(*) as encrypted_message_count FROM messages WHERE is_encrypted = 1;
