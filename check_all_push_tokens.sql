-- Check all push tokens to see what we have
SELECT 
    id,
    username,
    LEFT(token, 40) as token_preview,
    LENGTH(token) as token_length,
    platform,
    created_at,
    updated_at,
    is_active
FROM push_tokens
ORDER BY created_at DESC;

-- Show anonymous tokens
SELECT 
    'Anonymous tokens:' as info,
    COUNT(*) as count
FROM push_tokens 
WHERE username LIKE 'anonymous_%';

-- Token length check (real iOS tokens are 64+ characters)
SELECT 
    username,
    LENGTH(token) as token_length,
    CASE 
        WHEN LENGTH(token) < 50 THEN 'Test/Fake Token'
        WHEN LENGTH(token) >= 64 THEN 'Real iOS Token'
        ELSE 'Unknown'
    END as token_type
FROM push_tokens;
