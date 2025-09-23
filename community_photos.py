from flask import Blueprint, jsonify
from functools import wraps
import sqlite3
import logging

community_photos_bp = Blueprint('community_photos', __name__)

def get_db_connection():
    conn = sqlite3.connect('database.db')
    conn.row_factory = sqlite3.Row
    return conn

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # This is a placeholder for the actual login check.
        # In a real app, you would check for a valid session.
        return f(*args, **kwargs)
    return decorated_function

@community_photos_bp.route('/api/community_photos/<int:community_id>')
@login_required
def community_photos(community_id):
    """JSON API for community photos."""
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                """
                SELECT id, image_path, timestamp FROM posts
                WHERE community_id = ? AND image_path IS NOT NULL AND image_path != ''
                ORDER BY timestamp DESC
                """,
                (community_id,)
            )
            posts = [dict(row) for row in c.fetchall()]
            return jsonify({'success': True, 'photos': posts})
    except Exception as e:
        logging.error(f"Error fetching community photos: {str(e)}")
        return jsonify({'success': False, 'error': 'An error occurred while fetching photos.'})
