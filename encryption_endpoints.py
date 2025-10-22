"""
E2E Encryption API Endpoints
These endpoints handle public key bundle management for Signal Protocol
"""

from flask import request, jsonify, session
from functools import wraps
import json
from datetime import datetime

def login_required(f):
    """Decorator to require login"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'username' not in session:
            return jsonify({'success': False, 'error': 'Not logged in'}), 401
        return f(*args, **kwargs)
    return decorated_function

def register_encryption_endpoints(app, get_db_connection, logger):
    """Register all encryption-related endpoints"""
    
    @app.route('/api/encryption/upload-keys', methods=['POST'])
    @login_required
    def upload_encryption_keys():
        """Upload user's public key bundle to server"""
        try:
            username = session.get('username')
            data = request.get_json()
            
            if not data:
                return jsonify({'success': False, 'error': 'No data provided'}), 400
            
            identity_key = data.get('identityKey')
            signed_prekey = data.get('signedPreKey')
            pre_keys = data.get('preKeys', [])
            registration_id = data.get('registrationId')
            
            if not all([identity_key, signed_prekey, pre_keys, registration_id]):
                return jsonify({'success': False, 'error': 'Missing required fields'}), 400
            
            with get_db_connection() as conn:
                c = conn.cursor()
                
                # Store or update main identity key and signed pre-key
                now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                
                # Check if user already has keys
                c.execute("SELECT id FROM encryption_keys WHERE username = ?", (username,))
                existing = c.fetchone()
                
                if existing:
                    # Update existing keys
                    c.execute("""
                        UPDATE encryption_keys 
                        SET identity_key = ?, 
                            signed_prekey_id = ?, 
                            signed_prekey_public = ?, 
                            signed_prekey_signature = ?,
                            registration_id = ?,
                            updated_at = ?
                        WHERE username = ?
                    """, (
                        identity_key,
                        signed_prekey['keyId'],
                        signed_prekey['publicKey'],
                        signed_prekey['signature'],
                        registration_id,
                        now,
                        username
                    ))
                    
                    # Delete old pre-keys
                    c.execute("DELETE FROM encryption_prekeys WHERE username = ?", (username,))
                else:
                    # Insert new keys
                    c.execute("""
                        INSERT INTO encryption_keys 
                        (username, identity_key, signed_prekey_id, signed_prekey_public, 
                         signed_prekey_signature, registration_id, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        username,
                        identity_key,
                        signed_prekey['keyId'],
                        signed_prekey['publicKey'],
                        signed_prekey['signature'],
                        registration_id,
                        now,
                        now
                    ))
                
                # Insert pre-keys
                for pk in pre_keys:
                    c.execute("""
                        INSERT INTO encryption_prekeys 
                        (username, key_id, public_key, used, created_at)
                        VALUES (?, ?, ?, 0, ?)
                    """, (username, pk['keyId'], pk['publicKey'], now))
                
                conn.commit()
                
                logger.info(f"Uploaded encryption keys for user: {username}")
                return jsonify({'success': True})
                
        except Exception as e:
            logger.error(f"Error uploading encryption keys: {str(e)}")
            return jsonify({'success': False, 'error': str(e)}), 500
    
    @app.route('/api/encryption/get-keys/<username>', methods=['GET'])
    @login_required
    def get_encryption_keys(username):
        """Get public key bundle for a specific user"""
        try:
            with get_db_connection() as conn:
                c = conn.cursor()
                
                # Get user's main keys
                c.execute("""
                    SELECT identity_key, signed_prekey_id, signed_prekey_public, 
                           signed_prekey_signature, registration_id
                    FROM encryption_keys
                    WHERE username = ?
                """, (username,))
                
                user_keys = c.fetchone()
                if not user_keys:
                    return jsonify({'success': False, 'error': 'User has no encryption keys'}), 404
                
                # Get an unused pre-key (or any pre-key if all are used)
                c.execute("""
                    SELECT key_id, public_key
                    FROM encryption_prekeys
                    WHERE username = ? AND used = 0
                    ORDER BY created_at ASC
                    LIMIT 1
                """, (username,))
                
                prekey = c.fetchone()
                
                if not prekey:
                    # If no unused pre-keys, get any pre-key
                    c.execute("""
                        SELECT key_id, public_key
                        FROM encryption_prekeys
                        WHERE username = ?
                        ORDER BY created_at DESC
                        LIMIT 1
                    """, (username,))
                    prekey = c.fetchone()
                
                if not prekey:
                    return jsonify({'success': False, 'error': 'User has no pre-keys'}), 404
                
                # Mark pre-key as used
                c.execute("""
                    UPDATE encryption_prekeys
                    SET used = 1
                    WHERE username = ? AND key_id = ?
                """, (username, prekey[0] if isinstance(prekey, tuple) else prekey['key_id']))
                conn.commit()
                
                # Return key bundle
                return jsonify({
                    'success': True,
                    'identityKey': user_keys[0] if isinstance(user_keys, tuple) else user_keys['identity_key'],
                    'signedPreKey': {
                        'keyId': user_keys[1] if isinstance(user_keys, tuple) else user_keys['signed_prekey_id'],
                        'publicKey': user_keys[2] if isinstance(user_keys, tuple) else user_keys['signed_prekey_public'],
                        'signature': user_keys[3] if isinstance(user_keys, tuple) else user_keys['signed_prekey_signature'],
                    },
                    'preKey': {
                        'keyId': prekey[0] if isinstance(prekey, tuple) else prekey['key_id'],
                        'publicKey': prekey[1] if isinstance(prekey, tuple) else prekey['public_key'],
                    },
                    'registrationId': user_keys[4] if isinstance(user_keys, tuple) else user_keys['registration_id'],
                })
                
        except Exception as e:
            logger.error(f"Error getting encryption keys for {username}: {str(e)}")
            return jsonify({'success': False, 'error': str(e)}), 500
    
    @app.route('/api/encryption/backup', methods=['POST'])
    @login_required
    def backup_encryption_keys():
        """Backup encrypted keys to server"""
        try:
            username = session.get('username')
            data = request.get_json()
            
            encrypted_backup = data.get('encryptedBackup')
            salt = data.get('salt')
            
            if not encrypted_backup or not salt:
                return jsonify({'success': False, 'error': 'Missing backup data'}), 400
            
            with get_db_connection() as conn:
                c = conn.cursor()
                now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
                
                # Check if backup exists
                c.execute("SELECT id FROM encryption_backups WHERE username = ?", (username,))
                existing = c.fetchone()
                
                if existing:
                    # Update existing backup
                    c.execute("""
                        UPDATE encryption_backups
                        SET encrypted_backup = ?, salt = ?, updated_at = ?
                        WHERE username = ?
                    """, (encrypted_backup, salt, now, username))
                else:
                    # Create new backup
                    c.execute("""
                        INSERT INTO encryption_backups
                        (username, encrypted_backup, salt, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?)
                    """, (username, encrypted_backup, salt, now, now))
                
                conn.commit()
                logger.info(f"Encryption backup saved for user: {username}")
                return jsonify({'success': True})
                
        except Exception as e:
            logger.error(f"Error backing up encryption keys: {str(e)}")
            return jsonify({'success': False, 'error': str(e)}), 500
    
    @app.route('/api/encryption/restore', methods=['GET'])
    @login_required
    def restore_encryption_keys():
        """Restore encrypted keys from server backup"""
        try:
            username = session.get('username')
            
            with get_db_connection() as conn:
                c = conn.cursor()
                
                c.execute("""
                    SELECT encrypted_backup, salt
                    FROM encryption_backups
                    WHERE username = ?
                """, (username,))
                
                backup = c.fetchone()
                
                if not backup:
                    return jsonify({'success': False, 'error': 'No backup found'}), 404
                
                return jsonify({
                    'success': True,
                    'encryptedBackup': backup[0] if isinstance(backup, tuple) else backup['encrypted_backup'],
                    'salt': backup[1] if isinstance(backup, tuple) else backup['salt'],
                })
                
        except Exception as e:
            logger.error(f"Error restoring encryption keys: {str(e)}")
            return jsonify({'success': False, 'error': str(e)}), 500
    
    logger.info("✅ Encryption endpoints registered")
