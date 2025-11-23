"""
Helper functions for authentication and token management
"""

import logging
from backend.services.database import get_db_connection, get_sql_placeholder

logger = logging.getLogger(__name__)

def associate_anonymous_tokens_with_user(username: str):
    """
    When a user logs in, associate any anonymous push tokens from this device with their username.
    This handles the case where notification permission was granted before login.
    """
    try:
        from backend.services.database import USE_MYSQL
        
        conn = get_db_connection()
        cursor = conn.cursor()
        ph = get_sql_placeholder()
        
        # Find any anonymous tokens that should belong to this user
        # We'll match by checking if there are recent anonymous tokens
        if USE_MYSQL:
            time_condition = "created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)"
        else:
            time_condition = "created_at > datetime('now', '-1 hour')"
        
        cursor.execute(
            f"""
            SELECT id, token, platform 
            FROM push_tokens 
            WHERE username LIKE {ph}
            AND {time_condition}
            """,
            ('anonymous_%',)
        )
        
        anonymous_tokens = cursor.fetchall()
        
        if anonymous_tokens:
            logger.info(f"🔗 Found {len(anonymous_tokens)} anonymous token(s) to associate with {username}")
            
            for token_row in anonymous_tokens:
                token_id = token_row[0] if isinstance(token_row, tuple) else token_row['id']
                token = token_row[1] if isinstance(token_row, tuple) else token_row['token']
                platform = token_row[2] if isinstance(token_row, tuple) else token_row['platform']
                
                # Check if user already has a token for this platform
                cursor.execute(
                    f"SELECT id FROM push_tokens WHERE username = {ph} AND platform = {ph}",
                    (username, platform)
                )
                existing = cursor.fetchone()
                
                if existing:
                    # Delete the anonymous token and update the existing one
                    cursor.execute(
                        f"UPDATE push_tokens SET token = {ph}, updated_at = NOW(), is_active = 1 WHERE username = {ph} AND platform = {ph}",
                        (token, username, platform)
                    )
                    cursor.execute(
                        f"DELETE FROM push_tokens WHERE id = {ph}",
                        (token_id,)
                    )
                    logger.info(f"   ✅ Updated existing {platform} token for {username}")
                else:
                    # Update the anonymous token with the real username
                    cursor.execute(
                        f"UPDATE push_tokens SET username = {ph}, updated_at = NOW() WHERE id = {ph}",
                        (username, token_id)
                    )
                    logger.info(f"   ✅ Associated anonymous {platform} token with {username}")
            
            conn.commit()
            logger.info(f"✅ Successfully associated tokens with {username}")
        
        cursor.close()
        conn.close()
        
    except Exception as e:
        logger.error(f"Error associating anonymous tokens: {e}")
