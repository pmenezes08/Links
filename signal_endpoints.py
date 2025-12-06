"""
Signal Protocol API Endpoints

These endpoints handle device registration and key management for the Signal Protocol
multi-device E2E encryption system.

Key concepts:
- Each user can have multiple devices
- Each device has its own identity key pair
- Messages are encrypted separately for each recipient device
- PreKeys are one-time keys used for session establishment
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

def register_signal_endpoints(app, get_db_connection, logger):
    """Register all Signal Protocol endpoints"""

    @app.route('/api/signal/register-device', methods=['POST'])
    @login_required
    def register_device():
        """
        Register a new device for the current user.
        
        Request body:
        {
            "registrationId": 12345,
            "identityKeyPublic": "base64...",
            "signedPreKey": {
                "keyId": 1,
                "publicKey": "base64...",
                "signature": "base64..."
            },
            "preKeys": [
                {"keyId": 1, "publicKey": "base64..."},
                ...
            ]
        }
        """
        try:
            username = session.get('username')
            data = request.get_json()

            if not data:
                return jsonify({'success': False, 'error': 'No data provided'}), 400

            registration_id = data.get('registrationId')
            identity_key_public = data.get('identityKeyPublic')
            signed_prekey = data.get('signedPreKey')
            prekeys = data.get('preKeys', [])

            if not all([registration_id, identity_key_public, signed_prekey]):
                return jsonify({'success': False, 'error': 'Missing required fields'}), 400

            with get_db_connection() as conn:
                c = conn.cursor()
                now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

                # First, clean up old devices to prevent proliferation
                # Keep only the 2 most recent devices before adding new one
                c.execute("""
                    SELECT device_id FROM user_devices
                    WHERE username = ?
                    ORDER BY created_at DESC
                """, (username,))
                existing_devices = c.fetchall()
                
                # If user has 3+ devices, delete the oldest ones (keep 2)
                if len(existing_devices) >= 3:
                    devices_to_keep = 2
                    for i, device_row in enumerate(existing_devices):
                        if i >= devices_to_keep:
                            old_device_id = device_row[0] if isinstance(device_row, tuple) else device_row['device_id']
                            c.execute("DELETE FROM device_prekeys WHERE username = ? AND device_id = ?", 
                                      (username, old_device_id))
                            c.execute("DELETE FROM user_devices WHERE username = ? AND device_id = ?", 
                                      (username, old_device_id))
                    logger.info(f"Signal: Auto-cleaned {len(existing_devices) - devices_to_keep} old devices for {username}")

                # Get next device ID for this user
                c.execute(
                    "SELECT COALESCE(MAX(device_id), 0) + 1 FROM user_devices WHERE username = ?",
                    (username,)
                )
                result = c.fetchone()
                device_id = result[0] if isinstance(result, tuple) else result.get('COALESCE(MAX(device_id), 0) + 1', 1)
                
                # Detect device name from user agent
                user_agent = request.headers.get('User-Agent', '')
                device_name = 'Unknown Device'
                if 'iPhone' in user_agent or 'iPad' in user_agent:
                    device_name = 'iOS App'
                elif 'Android' in user_agent:
                    device_name = 'Android'
                elif 'Mac' in user_agent:
                    device_name = 'Mac Browser'
                elif 'Windows' in user_agent:
                    device_name = 'Windows Browser'
                elif 'Linux' in user_agent:
                    device_name = 'Linux Browser'
                else:
                    device_name = 'Web Browser'

                # Insert device
                c.execute("""
                    INSERT INTO user_devices 
                    (username, device_id, device_name, registration_id, identity_key_public,
                     signed_prekey_id, signed_prekey_public, signed_prekey_signature,
                     signed_prekey_timestamp, last_seen_at, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    username,
                    device_id,
                    device_name,
                    registration_id,
                    identity_key_public,
                    signed_prekey['keyId'],
                    signed_prekey['publicKey'],
                    signed_prekey['signature'],
                    int(datetime.now().timestamp() * 1000),
                    now,
                    now
                ))

                # Insert prekeys
                for pk in prekeys:
                    c.execute("""
                        INSERT INTO device_prekeys 
                        (username, device_id, key_id, public_key, created_at)
                        VALUES (?, ?, ?, ?, ?)
                    """, (username, device_id, pk['keyId'], pk['publicKey'], now))

                conn.commit()

                logger.info(f"Signal: Registered device {device_id} for user {username}")
                return jsonify({
                    'success': True,
                    'deviceId': device_id,
                    'deviceName': device_name
                })

        except Exception as e:
            logger.error(f"Signal: Error registering device: {str(e)}")
            return jsonify({'success': False, 'error': str(e)}), 500

    @app.route('/api/signal/devices/<username>', methods=['GET'])
    @login_required
    def get_user_devices(username):
        """Get all devices for a user"""
        try:
            with get_db_connection() as conn:
                c = conn.cursor()

                c.execute("""
                    SELECT device_id, device_name, registration_id, created_at, last_seen_at
                    FROM user_devices
                    WHERE username = ?
                    ORDER BY device_id
                """, (username,))

                rows = c.fetchall()
                devices = []
                
                for row in rows:
                    if isinstance(row, dict):
                        devices.append({
                            'deviceId': row['device_id'],
                            'deviceName': row['device_name'],
                            'registrationId': row['registration_id'],
                            'createdAt': row['created_at'],
                            'lastSeenAt': row.get('last_seen_at'),
                        })
                    else:
                        devices.append({
                            'deviceId': row[0],
                            'deviceName': row[1],
                            'registrationId': row[2],
                            'createdAt': row[3],
                            'lastSeenAt': row[4] if len(row) > 4 else None,
                        })

                return jsonify({'success': True, 'devices': devices})

        except Exception as e:
            logger.error(f"Signal: Error getting devices for {username}: {str(e)}")
            return jsonify({'success': False, 'error': str(e)}), 500

    @app.route('/api/signal/prekey-bundle/<username>/<int:device_id>', methods=['GET'])
    @login_required
    def get_prekey_bundle(username, device_id):
        """
        Get prekey bundle for establishing a session with a device.
        
        Returns:
        {
            "bundle": {
                "identityKey": "base64...",
                "registrationId": 12345,
                "deviceId": 1,
                "signedPreKey": {
                    "keyId": 1,
                    "publicKey": "base64...",
                    "signature": "base64..."
                },
                "preKey": {  // Optional, may not be available
                    "keyId": 1,
                    "publicKey": "base64..."
                }
            }
        }
        """
        try:
            with get_db_connection() as conn:
                c = conn.cursor()

                # Get device info
                c.execute("""
                    SELECT registration_id, identity_key_public,
                           signed_prekey_id, signed_prekey_public, signed_prekey_signature
                    FROM user_devices
                    WHERE username = ? AND device_id = ?
                """, (username, device_id))

                device = c.fetchone()
                if not device:
                    return jsonify({'success': False, 'error': 'Device not found'}), 404

                # Get one prekey (and mark as used by deleting it)
                c.execute("""
                    SELECT id, key_id, public_key
                    FROM device_prekeys
                    WHERE username = ? AND device_id = ?
                    ORDER BY key_id
                    LIMIT 1
                """, (username, device_id))

                prekey_row = c.fetchone()
                prekey = None
                
                if prekey_row:
                    if isinstance(prekey_row, dict):
                        prekey = {
                            'keyId': prekey_row['key_id'],
                            'publicKey': prekey_row['public_key']
                        }
                        prekey_id = prekey_row['id']
                    else:
                        prekey = {
                            'keyId': prekey_row[1],
                            'publicKey': prekey_row[2]
                        }
                        prekey_id = prekey_row[0]
                    
                    # Delete the used prekey
                    c.execute("DELETE FROM device_prekeys WHERE id = ?", (prekey_id,))
                    conn.commit()

                # Build bundle
                if isinstance(device, dict):
                    bundle = {
                        'identityKey': device['identity_key_public'],
                        'registrationId': device['registration_id'],
                        'deviceId': device_id,
                        'signedPreKey': {
                            'keyId': device['signed_prekey_id'],
                            'publicKey': device['signed_prekey_public'],
                            'signature': device['signed_prekey_signature'],
                        },
                    }
                else:
                    bundle = {
                        'identityKey': device[1],
                        'registrationId': device[0],
                        'deviceId': device_id,
                        'signedPreKey': {
                            'keyId': device[2],
                            'publicKey': device[3],
                            'signature': device[4],
                        },
                    }

                if prekey:
                    bundle['preKey'] = prekey

                return jsonify({'success': True, 'bundle': bundle})

        except Exception as e:
            logger.error(f"Signal: Error getting prekey bundle: {str(e)}")
            return jsonify({'success': False, 'error': str(e)}), 500

    @app.route('/api/signal/prekey-bundles/<username>', methods=['GET'])
    @login_required
    def get_all_prekey_bundles(username):
        """Get prekey bundles for all devices of a user"""
        try:
            with get_db_connection() as conn:
                c = conn.cursor()

                # Get all devices
                c.execute("""
                    SELECT device_id, registration_id, identity_key_public,
                           signed_prekey_id, signed_prekey_public, signed_prekey_signature
                    FROM user_devices
                    WHERE username = ?
                """, (username,))

                devices = c.fetchall()
                bundles = []

                for device in devices:
                    if isinstance(device, dict):
                        device_id = device['device_id']
                        reg_id = device['registration_id']
                        identity_key = device['identity_key_public']
                        spk_id = device['signed_prekey_id']
                        spk_public = device['signed_prekey_public']
                        spk_sig = device['signed_prekey_signature']
                    else:
                        device_id = device[0]
                        reg_id = device[1]
                        identity_key = device[2]
                        spk_id = device[3]
                        spk_public = device[4]
                        spk_sig = device[5]

                    # Get one prekey
                    c.execute("""
                        SELECT id, key_id, public_key
                        FROM device_prekeys
                        WHERE username = ? AND device_id = ?
                        ORDER BY key_id
                        LIMIT 1
                    """, (username, device_id))

                    prekey_row = c.fetchone()
                    prekey = None
                    
                    if prekey_row:
                        if isinstance(prekey_row, dict):
                            prekey = {
                                'keyId': prekey_row['key_id'],
                                'publicKey': prekey_row['public_key']
                            }
                            c.execute("DELETE FROM device_prekeys WHERE id = ?", (prekey_row['id'],))
                        else:
                            prekey = {
                                'keyId': prekey_row[1],
                                'publicKey': prekey_row[2]
                            }
                            c.execute("DELETE FROM device_prekeys WHERE id = ?", (prekey_row[0],))

                    bundle = {
                        'identityKey': identity_key,
                        'registrationId': reg_id,
                        'deviceId': device_id,
                        'signedPreKey': {
                            'keyId': spk_id,
                            'publicKey': spk_public,
                            'signature': spk_sig,
                        },
                    }

                    if prekey:
                        bundle['preKey'] = prekey

                    bundles.append(bundle)

                conn.commit()
                return jsonify({'success': True, 'bundles': bundles})

        except Exception as e:
            logger.error(f"Signal: Error getting prekey bundles: {str(e)}")
            return jsonify({'success': False, 'error': str(e)}), 500

    @app.route('/api/signal/device/<int:device_id>', methods=['DELETE'])
    @login_required
    def delete_device(device_id):
        """Unregister a device"""
        try:
            username = session.get('username')

            with get_db_connection() as conn:
                c = conn.cursor()

                # Verify device belongs to user
                c.execute(
                    "SELECT id FROM user_devices WHERE username = ? AND device_id = ?",
                    (username, device_id)
                )
                if not c.fetchone():
                    return jsonify({'success': False, 'error': 'Device not found'}), 404

                # Delete device and its prekeys
                c.execute(
                    "DELETE FROM device_prekeys WHERE username = ? AND device_id = ?",
                    (username, device_id)
                )
                c.execute(
                    "DELETE FROM user_devices WHERE username = ? AND device_id = ?",
                    (username, device_id)
                )

                conn.commit()

                logger.info(f"Signal: Deleted device {device_id} for user {username}")
                return jsonify({'success': True})

        except Exception as e:
            logger.error(f"Signal: Error deleting device: {str(e)}")
            return jsonify({'success': False, 'error': str(e)}), 500

    @app.route('/api/signal/update-signed-prekey', methods=['POST'])
    @login_required
    def update_signed_prekey():
        """Update signed prekey for a device"""
        try:
            username = session.get('username')
            data = request.get_json()

            device_id = data.get('deviceId')
            signed_prekey = data.get('signedPreKey')

            if not device_id or not signed_prekey:
                return jsonify({'success': False, 'error': 'Missing required fields'}), 400

            with get_db_connection() as conn:
                c = conn.cursor()

                c.execute("""
                    UPDATE user_devices
                    SET signed_prekey_id = ?,
                        signed_prekey_public = ?,
                        signed_prekey_signature = ?,
                        signed_prekey_timestamp = ?
                    WHERE username = ? AND device_id = ?
                """, (
                    signed_prekey['keyId'],
                    signed_prekey['publicKey'],
                    signed_prekey['signature'],
                    int(datetime.now().timestamp() * 1000),
                    username,
                    device_id
                ))

                conn.commit()

                logger.info(f"Signal: Updated signed prekey for device {device_id}")
                return jsonify({'success': True})

        except Exception as e:
            logger.error(f"Signal: Error updating signed prekey: {str(e)}")
            return jsonify({'success': False, 'error': str(e)}), 500

    @app.route('/api/signal/upload-prekeys', methods=['POST'])
    @login_required
    def upload_prekeys():
        """Upload new prekeys for a device"""
        try:
            username = session.get('username')
            data = request.get_json()

            device_id = data.get('deviceId')
            prekeys = data.get('preKeys', [])

            if not device_id or not prekeys:
                return jsonify({'success': False, 'error': 'Missing required fields'}), 400

            with get_db_connection() as conn:
                c = conn.cursor()
                now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

                for pk in prekeys:
                    c.execute("""
                        INSERT INTO device_prekeys 
                        (username, device_id, key_id, public_key, created_at)
                        VALUES (?, ?, ?, ?, ?)
                    """, (username, device_id, pk['keyId'], pk['publicKey'], now))

                conn.commit()

                logger.info(f"Signal: Uploaded {len(prekeys)} prekeys for device {device_id}")
                return jsonify({'success': True, 'count': len(prekeys)})

        except Exception as e:
            logger.error(f"Signal: Error uploading prekeys: {str(e)}")
            return jsonify({'success': False, 'error': str(e)}), 500

    @app.route('/api/signal/prekey-count', methods=['GET'])
    @login_required
    def get_prekey_count():
        """Get count of remaining prekeys for current device"""
        try:
            username = session.get('username')
            device_id = request.args.get('deviceId', type=int)

            if not device_id:
                return jsonify({'success': False, 'error': 'deviceId required'}), 400

            with get_db_connection() as conn:
                c = conn.cursor()

                c.execute("""
                    SELECT COUNT(*) FROM device_prekeys
                    WHERE username = ? AND device_id = ?
                """, (username, device_id))

                result = c.fetchone()
                count = result[0] if isinstance(result, tuple) else result.get('COUNT(*)', 0)

                return jsonify({'success': True, 'count': count})

        except Exception as e:
            logger.error(f"Signal: Error getting prekey count: {str(e)}")
            return jsonify({'success': False, 'error': str(e)}), 500

    @app.route('/api/signal/store-ciphertexts', methods=['POST'])
    @login_required
    def store_ciphertexts():
        """
        Store encrypted message ciphertexts for each target device.
        Called when sending an encrypted message.
        """
        try:
            username = session.get('username')
            data = request.get_json()

            message_id = data.get('messageId')
            ciphertexts = data.get('ciphertexts', [])
            sender_device_id = data.get('senderDeviceId')

            if not message_id or not ciphertexts:
                return jsonify({'success': False, 'error': 'Missing required fields'}), 400

            with get_db_connection() as conn:
                c = conn.cursor()
                now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

                for ct in ciphertexts:
                    c.execute("""
                        INSERT INTO message_ciphertexts
                        (message_id, target_username, target_device_id,
                         sender_username, sender_device_id, ciphertext, message_type, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        message_id,
                        ct['targetUsername'],
                        ct['targetDeviceId'],
                        username,
                        sender_device_id,
                        ct['ciphertext'],
                        ct['messageType'],
                        now
                    ))

                conn.commit()

                return jsonify({'success': True})

        except Exception as e:
            logger.error(f"Signal: Error storing ciphertexts: {str(e)}")
            return jsonify({'success': False, 'error': str(e)}), 500

    @app.route('/api/signal/get-ciphertext/<int:message_id>', methods=['GET'])
    @login_required
    def get_ciphertext(message_id):
        """
        Get the ciphertext for a message for the current device.
        """
        try:
            username = session.get('username')
            device_id = request.args.get('deviceId', type=int)

            if not device_id:
                return jsonify({'success': False, 'error': 'deviceId required'}), 400

            with get_db_connection() as conn:
                c = conn.cursor()

                c.execute("""
                    SELECT ciphertext, message_type, sender_username, sender_device_id
                    FROM message_ciphertexts
                    WHERE message_id = ? AND target_username = ? AND target_device_id = ?
                """, (message_id, username, device_id))

                row = c.fetchone()
                if not row:
                    return jsonify({'success': False, 'error': 'Ciphertext not found'}), 404

                if isinstance(row, dict):
                    return jsonify({
                        'success': True,
                        'ciphertext': row['ciphertext'],
                        'messageType': row['message_type'],
                        'senderUsername': row['sender_username'],
                        'senderDeviceId': row['sender_device_id'],
                    })
                else:
                    return jsonify({
                        'success': True,
                        'ciphertext': row[0],
                        'messageType': row[1],
                        'senderUsername': row[2],
                        'senderDeviceId': row[3],
                    })

        except (BrokenPipeError, OSError) as e:
            # Client disconnected before response could be sent - this is normal
            # and happens frequently on mobile apps when requests are cancelled
            logger.debug(f"Signal: Client disconnected during get-ciphertext/{message_id}: {str(e)}")
            return '', 499  # Use 499 (Client Closed Request) status code
        except Exception as e:
            logger.error(f"Signal: Error getting ciphertext: {str(e)}")
            return jsonify({'success': False, 'error': str(e)}), 500

    @app.route('/api/signal/my-devices', methods=['GET'])
    @login_required
    def get_my_devices():
        """Get all devices for the current user"""
        username = session.get('username')
        return get_user_devices(username)

    @app.route('/api/signal/cleanup-old-devices', methods=['POST'])
    @login_required
    def cleanup_old_devices():
        """
        Remove old devices for the current user, keeping only the most recent ones.
        Useful for cleaning up device proliferation on iOS.
        
        Request body (optional):
        {
            "keepCount": 2  // Number of most recent devices to keep (default: 2)
        }
        """
        try:
            username = session.get('username')
            data = request.get_json() or {}
            keep_count = data.get('keepCount', 2)
            
            with get_db_connection() as conn:
                c = conn.cursor()
                
                # Get all devices ordered by creation date (newest first)
                c.execute("""
                    SELECT device_id, device_name, created_at
                    FROM user_devices
                    WHERE username = ?
                    ORDER BY created_at DESC
                """, (username,))
                
                devices = c.fetchall()
                total_devices = len(devices)
                
                if total_devices <= keep_count:
                    return jsonify({
                        'success': True,
                        'message': f'No cleanup needed. You have {total_devices} device(s).',
                        'devicesRemoved': 0
                    })
                
                # Get IDs of devices to delete (older ones)
                devices_to_delete = []
                for i, device in enumerate(devices):
                    if i >= keep_count:
                        device_id = device['device_id'] if isinstance(device, dict) else device[0]
                        devices_to_delete.append(device_id)
                
                # Delete old devices and their prekeys
                for device_id in devices_to_delete:
                    c.execute("DELETE FROM device_prekeys WHERE username = ? AND device_id = ?", 
                              (username, device_id))
                    c.execute("DELETE FROM user_devices WHERE username = ? AND device_id = ?", 
                              (username, device_id))
                
                conn.commit()
                
                logger.info(f"Signal: Cleaned up {len(devices_to_delete)} old devices for {username}")
                return jsonify({
                    'success': True,
                    'message': f'Removed {len(devices_to_delete)} old device(s). Kept {keep_count} most recent.',
                    'devicesRemoved': len(devices_to_delete),
                    'devicesKept': keep_count
                })
                
        except Exception as e:
            logger.error(f"Signal: Error cleaning up devices: {str(e)}")
            return jsonify({'success': False, 'error': str(e)}), 500

    @app.route('/api/signal/debug-status', methods=['GET'])
    @login_required
    def debug_signal_status():
        """
        Debug endpoint to check Signal Protocol status for current user and optionally another user.
        Usage: /api/signal/debug-status?other_user=Maria
        """
        try:
            username = session.get('username')
            other_user = request.args.get('other_user')

            with get_db_connection() as conn:
                c = conn.cursor()
                
                # Get current user's devices
                c.execute("""
                    SELECT device_id, device_name, registration_id, created_at, last_seen_at
                    FROM user_devices
                    WHERE username = ?
                """, (username,))
                my_devices = c.fetchall()
                
                my_device_list = []
                for row in my_devices:
                    if isinstance(row, dict):
                        my_device_list.append({
                            'deviceId': row['device_id'],
                            'deviceName': row['device_name'],
                            'registrationId': row['registration_id'],
                            'createdAt': row['created_at'],
                            'lastSeenAt': row.get('last_seen_at'),
                        })
                    else:
                        my_device_list.append({
                            'deviceId': row[0],
                            'deviceName': row[1],
                            'registrationId': row[2],
                            'createdAt': row[3],
                            'lastSeenAt': row[4] if len(row) > 4 else None,
                        })
                
                # Get prekey count for each of my devices
                for device in my_device_list:
                    c.execute("""
                        SELECT COUNT(*) FROM device_prekeys
                        WHERE username = ? AND device_id = ?
                    """, (username, device['deviceId']))
                    result = c.fetchone()
                    device['prekeyCount'] = result[0] if isinstance(result, tuple) else result.get('COUNT(*)', 0)
                
                result = {
                    'success': True,
                    'currentUser': username,
                    'myDevices': my_device_list,
                    'myDeviceCount': len(my_device_list),
                }
                
                # If checking another user
                if other_user:
                    c.execute("""
                        SELECT device_id, device_name, registration_id, created_at, last_seen_at
                        FROM user_devices
                        WHERE username = ?
                    """, (other_user,))
                    other_devices = c.fetchall()
                    
                    other_device_list = []
                    for row in other_devices:
                        if isinstance(row, dict):
                            other_device_list.append({
                                'deviceId': row['device_id'],
                                'deviceName': row['device_name'],
                                'createdAt': row['created_at'],
                            })
                        else:
                            other_device_list.append({
                                'deviceId': row[0],
                                'deviceName': row[1],
                                'createdAt': row[3],
                            })
                    
                    result['otherUser'] = other_user
                    result['otherDevices'] = other_device_list
                    result['otherDeviceCount'] = len(other_device_list)
                    result['canSendEncrypted'] = len(other_device_list) > 0
                
                return jsonify(result)

        except Exception as e:
            logger.error(f"Signal debug error: {str(e)}")
            return jsonify({'success': False, 'error': str(e)}), 500

    @app.route('/api/signal/debug-message/<int:message_id>', methods=['GET'])
    @login_required
    def debug_message_ciphertexts(message_id):
        """
        Debug endpoint to check ciphertexts for a specific message.
        Shows which devices have ciphertexts stored.
        """
        try:
            username = session.get('username')

            with get_db_connection() as conn:
                c = conn.cursor()
                
                c.execute("""
                    SELECT target_username, target_device_id, sender_username, sender_device_id, message_type, created_at
                    FROM message_ciphertexts
                    WHERE message_id = ?
                """, (message_id,))
                rows = c.fetchall()
                
                ciphertexts = []
                for row in rows:
                    if isinstance(row, dict):
                        ciphertexts.append({
                            'targetUsername': row['target_username'],
                            'targetDeviceId': row['target_device_id'],
                            'senderUsername': row['sender_username'],
                            'senderDeviceId': row['sender_device_id'],
                            'messageType': row['message_type'],
                            'createdAt': row['created_at'],
                        })
                    else:
                        ciphertexts.append({
                            'targetUsername': row[0],
                            'targetDeviceId': row[1],
                            'senderUsername': row[2],
                            'senderDeviceId': row[3],
                            'messageType': row[4],
                            'createdAt': row[5],
                        })
                
                # Check if current user's current device has a ciphertext
                device_id = request.args.get('deviceId', type=int)
                has_ciphertext_for_me = any(
                    ct['targetUsername'] == username and ct['targetDeviceId'] == device_id
                    for ct in ciphertexts
                )
                
                return jsonify({
                    'success': True,
                    'messageId': message_id,
                    'ciphertextCount': len(ciphertexts),
                    'ciphertexts': ciphertexts,
                    'currentUser': username,
                    'currentDeviceId': device_id,
                    'hasCiphertextForCurrentDevice': has_ciphertext_for_me,
                })

        except Exception as e:
            logger.error(f"Signal debug message error: {str(e)}")
            return jsonify({'success': False, 'error': str(e)}), 500

    @app.route('/api/signal/force-init', methods=['POST'])
    @login_required
    def force_init_signal():
        """
        Debug endpoint to manually trigger Signal Protocol initialization check.
        Returns whether the user has devices and what the initialization status is.
        """
        try:
            username = session.get('username')
            
            with get_db_connection() as conn:
                c = conn.cursor()
                
                # Check if user has any devices
                c.execute("""
                    SELECT device_id, device_name, created_at, registration_id
                    FROM user_devices
                    WHERE username = ?
                    ORDER BY created_at DESC
                """, (username,))
                
                devices = c.fetchall()
                
                device_list = []
                for row in devices:
                    if isinstance(row, dict):
                        device_list.append({
                            'deviceId': row['device_id'],
                            'deviceName': row['device_name'],
                            'createdAt': row['created_at'],
                        })
                    else:
                        device_list.append({
                            'deviceId': row[0],
                            'deviceName': row[1],
                            'createdAt': row[2],
                        })
                
                return jsonify({
                    'success': True,
                    'username': username,
                    'hasDevices': len(devices) > 0,
                    'deviceCount': len(devices),
                    'devices': device_list,
                    'message': 'User has devices registered' if devices else 'No devices registered. Client-side Signal init may have failed - check browser console for errors.',
                    'troubleshooting': [
                        'Check browser console for "🔐 Initializing Signal Protocol" message',
                        'Look for any errors after that message',
                        'Make sure IndexedDB is working (not in private/incognito mode)',
                        'Try: localStorage.getItem("signal_device_id") in console',
                    ]
                })
                
        except Exception as e:
            logger.error(f"Signal force-init check error: {str(e)}")
            return jsonify({'success': False, 'error': str(e)}), 500

    logger.info("✅ Signal Protocol endpoints registered")
