from flask import Flask, render_template, request, jsonify, redirect, url_for, session, flash, abort, send_from_directory, Response
# from flask_wtf.csrf import CSRFProtect, generate_csrf, validate_csrf as wtf_validate_csrf
import os
import sys
import json
import sqlite3
import random
import re
import logging
import requests
import time
from datetime import datetime, timedelta
from functools import wraps
from markupsafe import escape
import secrets
from werkzeug.utils import secure_filename
from werkzeug.security import generate_password_hash, check_password_hash
from pywebpush import webpush, WebPushException
from hashlib import sha256

# Initialize Flask app
app = Flask(__name__, template_folder='templates')

# Custom template filters
@app.template_filter('nl2br')
def nl2br_filter(text):
    """Convert newlines to <br> tags"""
    if text is None:
        return ''
    return text.replace('\n', '<br>')

# Force reload to clear any cached routes - Updated 2025-08-21 16:50 - CLEAR CACHE

# Temporarily disable CSRF protection
# csrf = CSRFProtect(app)
# csrf.exempt(app)  # Disable CSRF protection globally

# File upload configuration
UPLOAD_FOLDER = 'static/uploads'
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# Session configuration: persist login for 30 days
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=30)
app.config['SESSION_COOKIE_SECURE'] = True
app.config['SESSION_COOKIE_DOMAIN'] = os.getenv('SESSION_COOKIE_DOMAIN') or None
app.config['PREFERRED_URL_SCHEME'] = 'https'

# Optional: enforce canonical host (e.g., www.c-point.co) to prevent cookie splits
CANONICAL_HOST = os.getenv('CANONICAL_HOST')  # e.g., 'www.c-point.co'
CANONICAL_SCHEME = os.getenv('CANONICAL_SCHEME', 'https')

@app.before_request
def enforce_canonical_host():
    try:
        if CANONICAL_HOST:
            # Avoid redirect loops and only redirect when host differs
            req_host = request.host.split(':')[0]
            if req_host != CANONICAL_HOST:
                target = f"{CANONICAL_SCHEME}://{CANONICAL_HOST}{request.full_path}"
                if target.endswith('?'):
                    target = target[:-1]
                return redirect(target, code=301)
    except Exception:
        # Never block request on redirect failure
        return None

def _issue_remember_token(response, username: str):
    try:
        # random 32-byte token -> hash stored; raw token in cookie
        raw = secrets.token_urlsafe(48)
        token_hash = sha256(raw.encode()).hexdigest()
        now = datetime.utcnow()
        expires = now + timedelta(days=30)
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("INSERT INTO remember_tokens (username, token_hash, created_at, expires_at) VALUES (?,?,?,?)",
                      (username, token_hash, now.isoformat(), expires.isoformat()))
            conn.commit()
        # Set cookie
        response.set_cookie(
            'remember_token', raw,
            max_age=30*24*60*60,
            secure=True,
            httponly=True,
            samesite='Lax',
            domain=os.getenv('SESSION_COOKIE_DOMAIN') or None,
            path='/'
        )
    except Exception as e:
        logger.warning(f"Failed to issue remember token: {e}")

@app.before_request
def auto_login_from_remember_token():
    try:
        if 'username' in session:
            return
        raw = request.cookies.get('remember_token')
        if not raw:
            return
        token_hash = sha256(raw.encode()).hexdigest()
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT username, expires_at FROM remember_tokens WHERE token_hash=? ORDER BY id DESC LIMIT 1", (token_hash,))
            row = c.fetchone()
        if not row:
            return
        username = row['username'] if hasattr(row, 'keys') else row[0]
        expires_at = row['expires_at'] if hasattr(row, 'keys') else row[1]
        if datetime.fromisoformat(expires_at) < datetime.utcnow():
            return
        # restore session
        session.permanent = True
        session['username'] = username
    except Exception as e:
        logger.warning(f"auto_login_from_remember_token failed: {e}")

# Create uploads directory if it doesn't exist
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# Load secret keys from environment variables
app.secret_key = os.getenv('FLASK_SECRET_KEY', 'temporary-secret-key-12345')
STRIPE_API_KEY = os.getenv('STRIPE_API_KEY', 'sk_test_your_stripe_key')
XAI_API_KEY = os.getenv('XAI_API_KEY', 'xai-hFCxhRKITxZXsIQy5rRpRus49rxcgUPw4NECAunCgHU0BnWnbPE9Y594Nk5jba03t5FYl2wJkjcwyxRh')
X_CONSUMER_KEY = os.getenv('X_CONSUMER_KEY', 'cjB0MmRPRFRnOG9jcTA0UGRZV006MTpjaQ')
X_CONSUMER_SECRET = os.getenv('X_CONSUMER_SECRET', 'Wxo9qnpOaDIJ-9Aw_Bl_MDkor4uY24ephq9ZJFq6HwdH7o4-kB')
VAPID_PUBLIC_KEY = os.getenv('VAPID_PUBLIC_KEY', '')
VAPID_PRIVATE_KEY = os.getenv('VAPID_PRIVATE_KEY', '')
VAPID_SUBJECT = os.getenv('VAPID_SUBJECT', 'https://www.c-point.co')
TYPING_TTL_SECONDS = 5



# Logging setup
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)


# Stripe setup (optional)
try:
    import stripe
    stripe.api_key = STRIPE_API_KEY
except ImportError:
    logger.warning("Stripe module not installed. Run 'pip install stripe'")
    stripe = None

# Import custom modules
try:
    from workouts import workouts as workout_data
    from nutrition_plans import nutrition_plans
except ImportError as e:
    logger.error(f"Failed to import custom modules: {e}")
    workout_data = {}
    nutrition_plans = {}

# OAuth setup for X
# oauth = OAuth(app)
# x_auth = oauth.remote_app(
#     'x',
#     consumer_key=X_CONSUMER_KEY,
#     consumer_secret=X_CONSUMER_SECRET,
#     request_token_params={'scope': 'users.read'},
#     base_url='https://api.x.com/2/',
#     request_token_url=None,
#     access_token_method='POST',
#     access_token_url='https://api.x.com/2/oauth2/token',
#     authorize_url='https://x.com/i/oauth2/authorize',
# )

# xAI API setup
XAI_API_URL = 'https://api.x.ai/v1/chat/completions'
DAILY_API_LIMIT = 10

USE_MYSQL = (os.getenv('DB_BACKEND', 'sqlite').lower() == 'mysql')

# Database connection helper: MySQL in production (if configured), SQLite locally
def get_db_connection():
    if USE_MYSQL:
        try:
            try:
                import pymysql
                from pymysql.cursors import DictCursor
            except Exception as imp_err:
                logger.error(f"PyMySQL not installed or failed to import: {imp_err}")
                raise

            host = os.environ.get('MYSQL_HOST')
            user = os.environ.get('MYSQL_USER')
            password = os.environ.get('MYSQL_PASSWORD')
            database = os.environ.get('MYSQL_DB')
            if not all([host, user, password, database]):
                raise RuntimeError('Missing MySQL env vars: MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DB')

            conn = pymysql.connect(
                host=host,
                user=user,
                password=password,
                database=database,
                charset='utf8mb4',
                autocommit=True,
                cursorclass=DictCursor,
            )
            # Wrap cursor to adapt SQLite-style SQL to MySQL at runtime
            try:
                orig_cursor = conn.cursor

                def _adapt_sql(sql: str) -> str:
                    s = sql
                    # Common cross-db adaptations
                    s = s.replace('INSERT IGNORE', 'INSERT IGNORE')
                    s = s.replace("NOW()", 'NOW()')
                    return s

                class _ProxyCursor:
                    def __init__(self, real):
                        self._real = real
                    def execute(self, query, params=None):
                        q = _adapt_sql(query)
                        if params is not None:
                            # Convert SQLite qmark '?' to MySQL '%s'
                            q = q.replace('?', '%s')
                            return self._real.execute(q, params)
                        return self._real.execute(q)
                    def executemany(self, query, param_seq):
                        q = _adapt_sql(query).replace('?', '%s')
                        return self._real.executemany(q, param_seq)
                    def __getattr__(self, name):
                        return getattr(self._real, name)

                def _patched_cursor(*args, **kwargs):
                    return _ProxyCursor(orig_cursor(*args, **kwargs))

                conn.cursor = _patched_cursor  # type: ignore[attr-defined]
            except Exception as _wrap_err:
                logger.warning(f"Could not wrap MySQL cursor for SQL adaptation: {_wrap_err}")
            return conn
        except Exception as e:
            logger.error(f"Failed to connect to MySQL: {e}")
            raise
    else:
        # SQLite (default for local dev)
        db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'users.db')
        try:
            conn = sqlite3.connect(db_path)
            conn.row_factory = sqlite3.Row
            return conn
        except Exception as e:
            logger.error(f"Failed to connect to database at {db_path}: {e}")
            # Try to ensure database exists and retry
            try:
                ensure_database_exists()
                conn = sqlite3.connect(db_path)
                conn.row_factory = sqlite3.Row
                return conn
            except Exception as e2:
                logger.error(f"Failed to create database and connect: {e2}")
                raise

def ensure_database_exists():
    """Ensure the database and all tables exist."""
    try:
        db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'users.db')
        logger.info(f"Database path: {db_path}")
        
        # Connect to database (this will create it if it doesn't exist)
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        
        # Check if users table exists
        c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
        users_table_exists = c.fetchone() is not None
        
        if not users_table_exists:
            logger.info("Users table does not exist. Creating all tables...")
            init_db()
        else:
            logger.info("Users table exists. Checking for missing tables and columns...")
            # Always check for missing tables and columns
            add_missing_tables()
        
        conn.close()
        logger.info("Database check completed successfully")
        
    except Exception as e:
        logger.error(f"Error ensuring database exists: {e}")
        raise

def add_missing_tables():
    """Add any missing tables to existing database."""
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Create messages table
            c.execute('''CREATE TABLE IF NOT EXISTS messages
                         (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                          sender TEXT NOT NULL,
                          receiver TEXT NOT NULL,
                          message TEXT NOT NULL,
                          timestamp TEXT NOT NULL,
                          is_read INTEGER DEFAULT 0,
                          FOREIGN KEY (sender) REFERENCES users(username),
                          FOREIGN KEY (receiver) REFERENCES users(username))''')
            
            # Create api_usage table if it doesn't exist
            c.execute('''CREATE TABLE IF NOT EXISTS api_usage
                         (username TEXT, date TEXT, count INTEGER,
                          PRIMARY KEY (username, date))''')
            
            # Create saved_data table if it doesn't exist
            c.execute('''CREATE TABLE IF NOT EXISTS saved_data
                         (id INTEGER PRIMARY KEY AUTO_INCREMENT, username TEXT, type TEXT, data TEXT, timestamp TEXT)''')
            # Store web push subscriptions
            c.execute('''CREATE TABLE IF NOT EXISTS push_subscriptions
                         (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                          username TEXT NOT NULL,
                          endpoint TEXT NOT NULL UNIQUE,
                          p256dh TEXT,
                          auth TEXT,
                          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')

            # Remember-me tokens for persistent login
            c.execute('''CREATE TABLE IF NOT EXISTS remember_tokens
                         (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                          username TEXT NOT NULL,
                          token_hash TEXT NOT NULL,
                          created_at TEXT NOT NULL,
                          expires_at TEXT NOT NULL)''')
            
            # Add missing columns to communities table
            columns_to_add = [
                ('description', 'TEXT'),
                ('location', 'TEXT'),
                ('background_path', 'TEXT'),
                ('template', 'TEXT'),
                ('background_color', 'TEXT'),
                ('text_color', 'TEXT'),
                ('accent_color', 'TEXT'),
                ('card_color', 'TEXT'),
                ('parent_community_id', 'INTEGER')
            ]
            
            for column_name, column_type in columns_to_add:
                try:
                    c.execute(f"ALTER TABLE communities ADD COLUMN {column_name} {column_type}")
                    logger.info(f"Added column {column_name} to communities table")
                except sqlite3.OperationalError as e:
                    if "duplicate column name" in str(e):
                        logger.info(f"Column {column_name} already exists in communities table")
                    else:
                        logger.warning(f"Could not add column {column_name}: {e}")
            
            # Add parent_reply_id column to replies if missing
            try:
                c.execute("ALTER TABLE replies ADD COLUMN parent_reply_id INTEGER")
                logger.info("Added column parent_reply_id to replies table")
            except sqlite3.OperationalError as e:
                if "duplicate column name" in str(e):
                    logger.info("Column parent_reply_id already exists in replies table")
                else:
                    logger.warning(f"Could not add column parent_reply_id: {e}")

            # Ensure messages table has is_read column
            try:
                c.execute("SHOW COLUMNS FROM messages LIKE 'is_read'")
                if not c.fetchone():
                    c.execute("ALTER TABLE messages ADD COLUMN is_read INTEGER DEFAULT 0")
                    logger.info("Added is_read column to messages table")
            except Exception as e:
                logger.warning(f"Could not ensure is_read column on messages: {e}")
            
            # Ensure messages table has image_path column for photo messages
            try:
                c.execute("SHOW COLUMNS FROM messages LIKE 'image_path'")
                if not c.fetchone():
                    c.execute("ALTER TABLE messages ADD COLUMN image_path TEXT")
                    conn.commit()
                    logger.info("Added image_path column to messages table")
            except Exception as e:
                logger.warning(f"Could not ensure image_path column on messages: {e}")

            # Typing status table for realtime UX
            c.execute('''CREATE TABLE IF NOT EXISTS typing_status (
                             id INTEGER PRIMARY KEY AUTO_INCREMENT,
                             user TEXT NOT NULL,
                             peer TEXT NOT NULL,
                             is_typing INTEGER DEFAULT 0,
                             updated_at TEXT NOT NULL,
                             UNIQUE(user, peer))''')

            # Ensure helpful indexes
            try:
                c.execute("CREATE INDEX IF NOT EXISTS idx_replies_post ON replies(post_id)")
                c.execute("CREATE INDEX IF NOT EXISTS idx_replies_parent ON replies(parent_reply_id)")
            except Exception as e:
                logger.warning(f"Could not create replies indexes: {e}")

            conn.commit()
            logger.info("Missing tables and columns added successfully")
            
    except Exception as e:
        logger.error(f"Error adding missing tables: {e}")
        raise

def init_db():
    """Initialize the database with all required tables."""
    try:
        logger.info("Starting database initialization...")
        
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Create users table
            logger.info("Creating users table...")
            c.execute('''CREATE TABLE IF NOT EXISTS users
                         (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                          username TEXT UNIQUE NOT NULL, email TEXT UNIQUE, subscription TEXT DEFAULT 'free', 
                          password TEXT, first_name TEXT, last_name TEXT, age INTEGER, gender TEXT, 
                          fitness_level TEXT, primary_goal TEXT, weight REAL, height REAL, blood_type TEXT, 
                          muscle_mass REAL, bmi REAL, nutrition_goal TEXT, nutrition_restrictions TEXT, 
                          created_at TEXT)''')
            
            # Add id column for MySQL compatibility if it doesn't exist
            try:
                c.execute("SELECT id FROM users LIMIT 1")
            except:
                logger.info("Adding id column to users table for MySQL compatibility...")
                c.execute("ALTER TABLE users ADD COLUMN id INTEGER PRIMARY KEY AUTO_INCREMENT FIRST")
                conn.commit()
            
            # Ensure user_communities table exists and has correct schema
            try:
                # Check if table exists
                c.execute("SHOW TABLES LIKE 'user_communities'")
                if not c.fetchone():
                    logger.info("Creating user_communities table...")
                    c.execute('''CREATE TABLE user_communities
                                 (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                                  user_id INTEGER NOT NULL,
                                  community_id INTEGER NOT NULL,
                                  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                                  FOREIGN KEY (user_id) REFERENCES users(id),
                                  FOREIGN KEY (community_id) REFERENCES communities(id),
                                  UNIQUE(user_id, community_id))''')
                    conn.commit()
                    logger.info("Created user_communities table")
                else:
                    # Table exists, check if it has user_id column
                    c.execute("SHOW COLUMNS FROM user_communities LIKE 'user_id'")
                    if not c.fetchone():
                        logger.info("user_id column missing, recreating user_communities table...")
                        c.execute("DROP TABLE user_communities")
                        c.execute('''CREATE TABLE user_communities
                                     (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                                      user_id INTEGER NOT NULL,
                                      community_id INTEGER NOT NULL,
                                      joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                                      FOREIGN KEY (user_id) REFERENCES users(id),
                                      FOREIGN KEY (community_id) REFERENCES communities(id),
                                      UNIQUE(user_id, community_id))''')
                        conn.commit()
                        logger.info("Recreated user_communities table with correct schema")
            except Exception as e:
                logger.error(f"Failed to ensure user_communities table: {e}")
            
            # Add missing columns to existing users table if they don't exist
            logger.info("Checking for missing columns...")
            columns_to_add = [
                ('email', 'TEXT'),
                ('first_name', 'TEXT'),
                ('last_name', 'TEXT'),
                ('age', 'INTEGER'),
                ('fitness_level', 'TEXT'),
                ('primary_goal', 'TEXT'),
                ('created_at', 'TEXT'),
                ('country', 'TEXT'),
                ('city', 'TEXT'),
                ('industry', 'TEXT'),
                ('role', 'TEXT'),
                ('company', 'TEXT'),
                ('degree', 'TEXT'),
                ('school', 'TEXT'),
                ('skills', 'TEXT'),
                ('linkedin', 'TEXT'),
                ('experience', 'INTEGER'),
                ('mobile', 'TEXT')
            ]
            
            for column_name, column_type in columns_to_add:
                try:
                    c.execute(f"ALTER TABLE users ADD COLUMN {column_name} {column_type}")
                    logger.info(f"Added column {column_name}")
                except sqlite3.OperationalError as e:
                    if "duplicate column name" in str(e):
                        logger.info(f"Column {column_name} already exists")
                    else:
                        logger.warning(f"Could not add column {column_name}: {e}")
            
            # Insert admin user
            logger.info("Inserting admin user...")
            c.execute("INSERT IGNORE INTO users (username, email, subscription, password, first_name, last_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                      ('admin', 'admin@cpoint.com', 'premium', '12345', 'Admin', 'User', datetime.now().strftime('%m.%d.%y %H:%M')))
            
            # Create posts table
            logger.info("Creating posts table...")
            # Create crossfit entries table (for lifts and WODs)
            logger.info("Creating crossfit entries table...")
            c.execute('''CREATE TABLE IF NOT EXISTS crossfit_entries (
                id INTEGER PRIMARY KEY AUTO_INCREMENT,
                username TEXT NOT NULL,
                type TEXT NOT NULL,
                name TEXT NOT NULL,
                weight REAL,
                reps INTEGER,
                score TEXT,
                score_numeric REAL,
                created_at TEXT NOT NULL
            )''')
            c.execute('''CREATE TABLE IF NOT EXISTS posts
                         (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                          username TEXT NOT NULL,
                          content TEXT NOT NULL,
                          image_path TEXT,
                          timestamp TEXT NOT NULL,
                          community_id INTEGER,
                          FOREIGN KEY (username) REFERENCES users(username))''')

            # Create replies table
            logger.info("Creating replies table...")
            c.execute('''CREATE TABLE IF NOT EXISTS replies
                         (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                          post_id INTEGER NOT NULL,
                          username TEXT NOT NULL,
                          content TEXT NOT NULL,
                          image_path TEXT,
                          timestamp TEXT NOT NULL,
                          community_id INTEGER,
                          FOREIGN KEY (post_id) REFERENCES posts(id),
                          FOREIGN KEY (username) REFERENCES users(username))''')

            # Create reactions table
            logger.info("Creating reactions table...")
            c.execute('''CREATE TABLE IF NOT EXISTS reactions
                         (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                          post_id INTEGER NOT NULL,
                          username TEXT NOT NULL,
                          reaction_type TEXT NOT NULL,
                          FOREIGN KEY (post_id) REFERENCES posts(id),
                          FOREIGN KEY (username) REFERENCES users(username),
                          UNIQUE(post_id, username))''')

            # Create reply_reactions table
            logger.info("Creating reply_reactions table...")
            c.execute('''CREATE TABLE IF NOT EXISTS reply_reactions
                         (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                          reply_id INTEGER NOT NULL,
                          username TEXT NOT NULL,
                          reaction_type TEXT NOT NULL,
                          FOREIGN KEY (reply_id) REFERENCES replies(id),
                          FOREIGN KEY (username) REFERENCES users(username),
                          UNIQUE(reply_id, username))''')

            # Create communities table
            logger.info("Creating communities table...")
            c.execute('''CREATE TABLE IF NOT EXISTS communities
                         (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                          name TEXT NOT NULL,
                          type TEXT NOT NULL,
                          creator_username TEXT NOT NULL,
                          join_code TEXT UNIQUE NOT NULL,
                          created_at TEXT NOT NULL,
                          description TEXT,
                          location TEXT,
                          background_path TEXT,
                          info TEXT,
                          info_updated_at TEXT,
                          template TEXT DEFAULT 'default',
                          background_color TEXT DEFAULT '#2d3839',
                          text_color TEXT DEFAULT '#ffffff',
                          accent_color TEXT DEFAULT '#4db6ac',
                          card_color TEXT DEFAULT '#1a2526',
                          parent_community_id INTEGER,
                          FOREIGN KEY (creator_username) REFERENCES users(username),
                          FOREIGN KEY (parent_community_id) REFERENCES communities(id))''')

            # Create user_communities table
            logger.info("Creating user_communities table...")
            c.execute('''CREATE TABLE IF NOT EXISTS user_communities
                         (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                          user_id INTEGER NOT NULL,
                          community_id INTEGER NOT NULL,
                          joined_at TEXT NOT NULL,
                          FOREIGN KEY (user_id) REFERENCES users(id),
                          FOREIGN KEY (community_id) REFERENCES communities(id),
                          UNIQUE(user_id, community_id))''')

            # Create community_files table
            logger.info("Creating community_files table...")
            c.execute('''CREATE TABLE IF NOT EXISTS community_files
                         (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                          community_id INTEGER NOT NULL,
                          filename TEXT NOT NULL,
                          uploaded_by TEXT NOT NULL,
                          upload_date TEXT NOT NULL,
                          description TEXT,
                          FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE,
                          FOREIGN KEY (uploaded_by) REFERENCES users(username))''')

            # Create notifications table
            logger.info("Creating notifications table...")
            c.execute('''CREATE TABLE IF NOT EXISTS notifications
                         (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                          user_id TEXT NOT NULL,
                          from_user TEXT,
                          type TEXT NOT NULL,
                          post_id INTEGER,
                          community_id INTEGER,
                          message TEXT,
                          is_read INTEGER DEFAULT 0,
                          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                          FOREIGN KEY (post_id) REFERENCES posts(id),
                          FOREIGN KEY (community_id) REFERENCES communities(id))''')
            
            # Create community_announcements table
            logger.info("Creating community_announcements table...")
            c.execute('''CREATE TABLE IF NOT EXISTS community_announcements
                         (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                          community_id INTEGER NOT NULL,
                          content TEXT NOT NULL,
                          created_by TEXT NOT NULL,
                          created_at TEXT NOT NULL,
                          FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE,
                          FOREIGN KEY (created_by) REFERENCES users(username))''')

            # Create api_usage table
            logger.info("Creating api_usage table...")
            c.execute('''CREATE TABLE IF NOT EXISTS api_usage
                         (username TEXT, date TEXT, count INTEGER,
                          PRIMARY KEY (username, date))''')
            
            # Create saved_data table
            logger.info("Creating saved_data table...")
            c.execute('''CREATE TABLE IF NOT EXISTS saved_data
                         (id INTEGER PRIMARY KEY AUTO_INCREMENT, username TEXT, type TEXT, data TEXT, timestamp TEXT)''')
            
            # Create messages table
            logger.info("Creating messages table...")
            c.execute('''CREATE TABLE IF NOT EXISTS messages
                         (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                          sender TEXT NOT NULL,
                          receiver TEXT NOT NULL,
                          message TEXT NOT NULL,
                          timestamp TEXT NOT NULL,
                          is_read INTEGER DEFAULT 0,
                          FOREIGN KEY (sender) REFERENCES users(username),
                          FOREIGN KEY (receiver) REFERENCES users(username))''')

            # Create workout-related tables
            logger.info("Creating workout tables...")
            c.execute('''CREATE TABLE IF NOT EXISTS exercises
                         (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                          username TEXT NOT NULL,
                          name TEXT NOT NULL,
                          muscle_group TEXT NOT NULL,
                          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
            
            c.execute('''CREATE TABLE IF NOT EXISTS exercise_sets
                         (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                          exercise_id INTEGER NOT NULL,
                          weight REAL NOT NULL,
                          reps INTEGER NOT NULL,
                          created_at TEXT NOT NULL,
                          FOREIGN KEY (exercise_id) REFERENCES exercises (id) ON DELETE CASCADE
                         )''')
            
            c.execute('''CREATE TABLE IF NOT EXISTS workouts
                         (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                          username TEXT NOT NULL,
                          name TEXT NOT NULL,
                          date TEXT NOT NULL,
                          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
            
            c.execute('''CREATE TABLE IF NOT EXISTS workout_exercises
                         (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                          workout_id INTEGER NOT NULL,
                          exercise_id INTEGER NOT NULL,
                          sets INTEGER DEFAULT 0,
                          reps INTEGER DEFAULT 0,
                          weight REAL DEFAULT 0,
                          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                          FOREIGN KEY (workout_id) REFERENCES workouts (id) ON DELETE CASCADE,
                          FOREIGN KEY (exercise_id) REFERENCES exercises (id) ON DELETE CASCADE)''')

            # Add info column to communities table if it doesn't exist
            try:
                c.execute("SELECT info FROM communities LIMIT 1")
            except sqlite3.OperationalError:
                logger.info("Adding info column to communities table...")
                c.execute("ALTER TABLE communities ADD COLUMN info TEXT")
            
            # Add info_updated_at column to communities table if it doesn't exist
            try:
                c.execute("SELECT info_updated_at FROM communities LIMIT 1")
            except sqlite3.OperationalError:
                logger.info("Adding info_updated_at column to communities table...")
                c.execute("ALTER TABLE communities ADD COLUMN info_updated_at TEXT")
            
            # Add description column to community_files table if it doesn't exist
            try:
                c.execute("SELECT description FROM community_files LIMIT 1")
            except sqlite3.OperationalError:
                logger.info("Adding description column to community_files table...")
                c.execute("ALTER TABLE community_files ADD COLUMN description TEXT")
            
                        # Create polls table
            logger.info("Creating polls table...")
            c.execute('''        CREATE TABLE IF NOT EXISTS polls
         (id INTEGER PRIMARY KEY AUTO_INCREMENT,
          post_id INTEGER NOT NULL,
          question TEXT NOT NULL,
          created_by TEXT NOT NULL,
          created_at TEXT NOT NULL,
          expires_at TEXT,
          is_active TINYINT(1) DEFAULT 1,
          single_vote TINYINT(1) DEFAULT 1,
          FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE)''')
            
            # Add single_vote column if it doesn't exist
            try:
                c.execute("SELECT single_vote FROM polls LIMIT 1")
            except:
                logger.info("Adding single_vote column to polls table...")
                c.execute("ALTER TABLE polls ADD COLUMN single_vote TINYINT(1) DEFAULT 1")
            
            # Create poll_options table
            logger.info("Creating poll_options table...")
            c.execute('''CREATE TABLE IF NOT EXISTS poll_options
                         (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                          poll_id INTEGER NOT NULL,
                          option_text TEXT NOT NULL,
                          votes INTEGER DEFAULT 0,
                          FOREIGN KEY (poll_id) REFERENCES polls (id) ON DELETE CASCADE)''')
            
            # Create poll_votes table
            logger.info("Creating poll_votes table...")
            c.execute('''CREATE TABLE IF NOT EXISTS poll_votes
                         (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                          poll_id INTEGER NOT NULL,
                          option_id INTEGER NOT NULL,
                          username TEXT NOT NULL,
                          voted_at TEXT NOT NULL,
                          FOREIGN KEY (poll_id) REFERENCES polls (id) ON DELETE CASCADE,
                          FOREIGN KEY (option_id) REFERENCES poll_options (id) ON DELETE CASCADE,
                          UNIQUE(poll_id, username))''')
            # Migrate poll_votes unique constraint to allow multiple votes per user per poll option
            try:
                # Check if poll_votes table needs migration by checking constraint
                c.execute("SHOW CREATE TABLE poll_votes")
                row = c.fetchone()
                if row and row['Create Table'] and 'UNIQUE(poll_id, username)' in row['Create Table'] and 'option_id' not in row['Create Table'].split('UNIQUE')[-1]:
                    logger.info('Migrating poll_votes unique constraint to (poll_id, username, option_id)')
                    c.execute('SET foreign_key_checks = 0')
                    c.execute('''CREATE TABLE IF NOT EXISTS poll_votes_new (
                        id INTEGER PRIMARY KEY AUTO_INCREMENT,
                        poll_id INTEGER NOT NULL,
                        option_id INTEGER NOT NULL,
                        username TEXT NOT NULL,
                        voted_at TEXT NOT NULL,
                        FOREIGN KEY (poll_id) REFERENCES polls (id) ON DELETE CASCADE,
                        FOREIGN KEY (option_id) REFERENCES poll_options (id) ON DELETE CASCADE,
                        UNIQUE(poll_id, username, option_id)
                    )''')
                    c.execute('INSERT IGNORE INTO poll_votes_new (poll_id, option_id, username, voted_at) SELECT poll_id, option_id, username, voted_at FROM poll_votes')
                    c.execute('DROP TABLE poll_votes')
                    c.execute('ALTER TABLE poll_votes_new RENAME TO poll_votes')
                    c.execute('SET foreign_key_checks = 1')
                    logger.info('poll_votes migration completed')
            except Exception as e:
                logger.warning(f'poll_votes migration skipped or failed: {e}')
            
            # Create community_issues table
            logger.info("Creating community_issues table...")
            c.execute('''CREATE TABLE IF NOT EXISTS community_issues
                         (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                          community_id INTEGER NOT NULL,
                          title TEXT NOT NULL,
                          location TEXT NOT NULL,
                          priority TEXT NOT NULL,
                          description TEXT NOT NULL,
                          reported_by TEXT NOT NULL,
                          reported_at TEXT NOT NULL,
                          resolved TINYINT(1) DEFAULT 0,
                          resolved_by TEXT,
                          resolved_at TEXT,
                          upvotes INTEGER DEFAULT 0,
                          FOREIGN KEY (community_id) REFERENCES communities (id) ON DELETE CASCADE,
                          FOREIGN KEY (reported_by) REFERENCES users (username))''')
            
            # Create issue_upvotes table
            logger.info("Creating issue_upvotes table...")
            c.execute('''CREATE TABLE IF NOT EXISTS issue_upvotes
                         (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                          issue_id INTEGER NOT NULL,
                          username TEXT NOT NULL,
                          upvoted_at TEXT NOT NULL,
                          FOREIGN KEY (issue_id) REFERENCES community_issues (id) ON DELETE CASCADE,
                          FOREIGN KEY (username) REFERENCES users (username),
                          UNIQUE(issue_id, username))''')
            
            # Create password_reset_tokens table
            logger.info("Creating password_reset_tokens table...")
            c.execute('''CREATE TABLE IF NOT EXISTS password_reset_tokens
                         (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                          username TEXT NOT NULL,
                          email TEXT NOT NULL,
                          token TEXT NOT NULL UNIQUE,
                          created_at TEXT NOT NULL,
                          used TINYINT(1) DEFAULT 0,
                          FOREIGN KEY (username) REFERENCES users (username))''')
            
            # Create university_ads table
            logger.info("Creating university_ads table...")
            c.execute('''CREATE TABLE IF NOT EXISTS university_ads
                         (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                          community_id INTEGER NOT NULL,
                          title TEXT NOT NULL,
                          description TEXT,
                          price TEXT NOT NULL,
                          image_url TEXT NOT NULL,
                          link_url TEXT,
                          is_active TINYINT(1) DEFAULT 1,
                          display_order INTEGER DEFAULT 0,
                          created_at TEXT NOT NULL,
                          created_by TEXT NOT NULL,
                          clicks INTEGER DEFAULT 0,
                          impressions INTEGER DEFAULT 0,
                          FOREIGN KEY (community_id) REFERENCES communities (id) ON DELETE CASCADE,
                          FOREIGN KEY (created_by) REFERENCES users (username))''')
            
            # Add impressions column if it doesn't exist (for existing databases)
            try:
                c.execute("SELECT impressions FROM university_ads LIMIT 1")
            except:
                logger.info("Adding impressions column to university_ads table...")
                c.execute("ALTER TABLE university_ads ADD COLUMN impressions INTEGER DEFAULT 0")
            
            # Create user activity tracking tables
            logger.info("Creating user activity tracking tables...")
            
            # Login history table
            c.execute('''CREATE TABLE IF NOT EXISTS user_login_history
                         (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                          username VARCHAR(255) NOT NULL,
                          login_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                          ip_address VARCHAR(45),
                          user_agent TEXT,
                          FOREIGN KEY (username) REFERENCES users (username))''')
            
            # Community visit history table
            c.execute('''CREATE TABLE IF NOT EXISTS community_visit_history
                         (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                          username TEXT NOT NULL,
                          community_id INTEGER NOT NULL,
                          visit_time TEXT NOT NULL,
                          FOREIGN KEY (username) REFERENCES users (username),
                          FOREIGN KEY (community_id) REFERENCES communities (id))''')
            
            # Create indexes for better performance
            c.execute("CREATE INDEX IF NOT EXISTS idx_login_username ON user_login_history(username)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_login_time ON user_login_history(login_time)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_visit_username ON community_visit_history(username)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_visit_community ON community_visit_history(community_id)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_visit_time ON community_visit_history(visit_time)")
            
            # Create resource sharing tables
            logger.info("Creating resource sharing tables...")
            
            # Resource posts table
            c.execute('''CREATE TABLE IF NOT EXISTS resource_posts
                         (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                          community_id INTEGER NOT NULL,
                          username TEXT NOT NULL,
                          title TEXT NOT NULL,
                          content TEXT NOT NULL,
                          category TEXT,
                          attachment_url TEXT,
                          created_at TEXT NOT NULL,
                          updated_at TEXT,
                          upvotes INTEGER DEFAULT 0,
                          views INTEGER DEFAULT 0,
                          is_pinned TINYINT(1) DEFAULT 0,
                          FOREIGN KEY (community_id) REFERENCES communities (id) ON DELETE CASCADE,
                          FOREIGN KEY (username) REFERENCES users (username))''')
            
            # Resource comments table
            c.execute('''CREATE TABLE IF NOT EXISTS resource_comments
                         (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                          post_id INTEGER NOT NULL,
                          username TEXT NOT NULL,
                          content TEXT NOT NULL,
                          created_at TEXT NOT NULL,
                          upvotes INTEGER DEFAULT 0,
                          FOREIGN KEY (post_id) REFERENCES resource_posts (id) ON DELETE CASCADE,
                          FOREIGN KEY (username) REFERENCES users (username))''')
            
            # Resource upvotes table (to track who upvoted what)
            c.execute('''CREATE TABLE IF NOT EXISTS resource_upvotes
                         (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                          post_id INTEGER,
                          comment_id INTEGER,
                          username TEXT NOT NULL,
                          created_at TEXT NOT NULL,
                          FOREIGN KEY (post_id) REFERENCES resource_posts (id) ON DELETE CASCADE,
                          FOREIGN KEY (comment_id) REFERENCES resource_comments (id) ON DELETE CASCADE,
                          FOREIGN KEY (username) REFERENCES users (username),
                          UNIQUE(post_id, username),
                          UNIQUE(comment_id, username))''')
            
            # Create indexes for resource tables
            c.execute("CREATE INDEX IF NOT EXISTS idx_resource_posts_community ON resource_posts(community_id)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_resource_posts_username ON resource_posts(username)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_resource_comments_post ON resource_comments(post_id)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_resource_upvotes_post ON resource_upvotes(post_id)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_resource_upvotes_comment ON resource_upvotes(comment_id)")
            
            # Create clubs and organizations tables
            logger.info("Creating clubs and organizations tables...")
            
            # Clubs table
            c.execute('''CREATE TABLE IF NOT EXISTS clubs
                         (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                          community_id INTEGER NOT NULL,
                          name TEXT NOT NULL,
                          description TEXT,
                          category TEXT,
                          contact_email TEXT,
                          contact_person TEXT,
                          meeting_schedule TEXT,
                          location TEXT,
                          website_url TEXT,
                          logo_url TEXT,
                          is_active TINYINT(1) DEFAULT 1,
                          member_count INTEGER DEFAULT 0,
                          created_by TEXT NOT NULL,
                          created_at TEXT NOT NULL,
                          FOREIGN KEY (community_id) REFERENCES communities (id) ON DELETE CASCADE,
                          FOREIGN KEY (created_by) REFERENCES users (username))''')
            
            # Club members table
            c.execute('''CREATE TABLE IF NOT EXISTS club_members
                         (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                          club_id INTEGER NOT NULL,
                          username TEXT NOT NULL,
                          role TEXT DEFAULT 'member',
                          joined_at TEXT NOT NULL,
                          FOREIGN KEY (club_id) REFERENCES clubs (id) ON DELETE CASCADE,
                          FOREIGN KEY (username) REFERENCES users (username),
                          UNIQUE(club_id, username))''')
            
            # Anonymous feedback table
            c.execute('''CREATE TABLE IF NOT EXISTS anonymous_feedback
                         (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                          community_id INTEGER NOT NULL,
                          feedback_text TEXT NOT NULL,
                          category TEXT,
                          priority TEXT DEFAULT 'normal',
                          status TEXT DEFAULT 'unread',
                          submitted_at TEXT NOT NULL,
                          response TEXT,
                          responded_at TEXT,
                          FOREIGN KEY (community_id) REFERENCES communities (id) ON DELETE CASCADE)''')
            
            # Create indexes for clubs and feedback
            c.execute("CREATE INDEX IF NOT EXISTS idx_clubs_community ON clubs(community_id)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_club_members_club ON club_members(club_id)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_club_members_username ON club_members(username)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_feedback_community ON anonymous_feedback(community_id)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_feedback_status ON anonymous_feedback(status)")
            
            # Create community admins table
            logger.info("Creating community admins table...")
            c.execute('''CREATE TABLE IF NOT EXISTS community_admins
                         (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                          community_id INTEGER NOT NULL,
                          username TEXT NOT NULL,
                          appointed_by TEXT NOT NULL,
                          appointed_at TEXT NOT NULL,
                          FOREIGN KEY (community_id) REFERENCES communities (id) ON DELETE CASCADE,
                          FOREIGN KEY (username) REFERENCES users (username),
                          FOREIGN KEY (appointed_by) REFERENCES users (username),
                          UNIQUE(community_id, username))''')
            
            # Add is_active columns to users and communities if they don't exist
            logger.info("Adding is_active columns...")
            
            # Check and add is_active to users table
            c.execute("SHOW COLUMNS FROM users LIKE 'is_active'")
            if not c.fetchone():
                c.execute("ALTER TABLE users ADD COLUMN is_active TINYINT(1) DEFAULT 1")
                logger.info("Added is_active column to users table")
            
            # Ensure notifications table has required columns
            try:
                # Check if created_at column exists
                c.execute("SHOW COLUMNS FROM notifications LIKE 'created_at'")
                if not c.fetchone():
                    c.execute("ALTER TABLE notifications ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP")
                    logger.info("Added created_at column to notifications table")
                
                # Check if link column exists
                c.execute("SHOW COLUMNS FROM notifications LIKE 'link'")
                if not c.fetchone():
                    c.execute("ALTER TABLE notifications ADD COLUMN link TEXT")
                    logger.info("Added link column to notifications table")
            except Exception as e:
                logger.error(f"Failed to update notifications table: {e}")
            
            # Check and add is_active to communities table  
            c.execute("SHOW COLUMNS FROM communities LIKE 'is_active'")
            if not c.fetchone():
                c.execute("ALTER TABLE communities ADD COLUMN is_active TINYINT(1) DEFAULT 1")
                logger.info("Added is_active column to communities table")
            
            # Create index for community admins
            c.execute("CREATE INDEX IF NOT EXISTS idx_community_admins_community ON community_admins(community_id)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_community_admins_username ON community_admins(username)")
            
            # Add community_id to calendar_events if it doesn't exist
            logger.info("Checking calendar_events table...")
            # Ensure calendar_events table exists before altering
            c.execute("""
                CREATE TABLE IF NOT EXISTS calendar_events (
                    id INTEGER PRIMARY KEY AUTO_INCREMENT,
                    title TEXT,
                    description TEXT,
                    start_time TEXT,
                    end_time TEXT,
                    location TEXT
                )
            """)
            c.execute("SHOW COLUMNS FROM calendar_events LIKE 'community_id'")
            if not c.fetchone():
                c.execute("ALTER TABLE calendar_events ADD COLUMN community_id INTEGER")
                logger.info("Added community_id column to calendar_events table")
            
            # Create event RSVPs table
            logger.info("Creating event RSVPs table...")
            c.execute('''CREATE TABLE IF NOT EXISTS event_rsvps
                         (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                          event_id INTEGER NOT NULL,
                          username TEXT NOT NULL,
                          response TEXT NOT NULL CHECK(response IN ('going', 'maybe', 'not_going')),
                          responded_at TEXT NOT NULL,
                          note TEXT,
                          FOREIGN KEY (event_id) REFERENCES calendar_events (id) ON DELETE CASCADE,
                          FOREIGN KEY (username) REFERENCES users (username),
                          UNIQUE(event_id, username))''')
            
            # Create indexes for RSVPs
            c.execute("CREATE INDEX IF NOT EXISTS idx_rsvps_event ON event_rsvps(event_id)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_rsvps_username ON event_rsvps(username)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_rsvps_response ON event_rsvps(response)")
            
            # Create event invitations table
            logger.info("Creating event invitations table...")
            c.execute('''CREATE TABLE IF NOT EXISTS event_invitations
                         (id INTEGER PRIMARY KEY AUTO_INCREMENT,
                          event_id INTEGER NOT NULL,
                          invited_username TEXT NOT NULL,
                          invited_by TEXT NOT NULL,
                          invited_at TEXT NOT NULL,
                          viewed TINYINT(1) DEFAULT 0,
                          FOREIGN KEY (event_id) REFERENCES calendar_events (id) ON DELETE CASCADE,
                          FOREIGN KEY (invited_username) REFERENCES users (username),
                          FOREIGN KEY (invited_by) REFERENCES users (username),
                          UNIQUE(event_id, invited_username))''')
            
            # Create indexes for invitations
            c.execute("CREATE INDEX IF NOT EXISTS idx_invitations_event ON event_invitations(event_id)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_invitations_username ON event_invitations(invited_username)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_invitations_viewed ON event_invitations(viewed)")
            
            conn.commit()
            logger.info("Database initialization completed successfully")
            
    except Exception as e:
        logger.error(f"Error initializing database: {e}")
        raise

def ensure_indexes():
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            # ... (keep all your existing CREATE INDEX statements) ...

            # Add an index for the new table
            c.execute("CREATE INDEX IF NOT EXISTS idx_reactions_post_id ON reactions(post_id)")

            # Add index for reply reactions
            c.execute("CREATE INDEX IF NOT EXISTS idx_reply_reactions_reply_id ON reply_reactions(reply_id)")

            # Add indexes for communities
            c.execute("CREATE INDEX IF NOT EXISTS idx_communities_join_code ON communities(join_code)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_communities_creator ON communities(creator_username)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_user_communities_user_id ON user_communities(user_id)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_user_communities_community_id ON user_communities(community_id)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_posts_community_id ON posts(community_id)")
            c.execute("CREATE INDEX IF NOT EXISTS idx_replies_community_id ON replies(community_id)")

            conn.commit()
        logger.info("Database indexes ensured")
    except Exception as e:
        logger.error(f"Error ensuring indexes: {e}")
        abort(500)

# Permission helper functions
def is_app_admin(username):
    """Check if user is the app admin"""
    return username == 'admin'

def is_community_owner(username, community_id):
    """Check if user is the owner of a community"""
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT creator_username FROM communities WHERE id = ?", (community_id,))
            result = c.fetchone()
            return result and result['creator_username'] == username
    except:
        return False

def is_community_admin(username, community_id):
    """Check if user is an admin of a community"""
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT 1 FROM community_admins WHERE community_id = ? AND username = ?", 
                     (community_id, username))
            return c.fetchone() is not None
    except:
        return False

def has_community_management_permission(username, community_id):
    """Check if user can manage a community (app admin, owner, or community admin)"""
    return (is_app_admin(username) or 
            is_community_owner(username, community_id) or 
            is_community_admin(username, community_id))

def has_post_delete_permission(username, post_username, community_id):
    """Check if user can delete a post"""
    return (is_app_admin(username) or 
            username == post_username or
            is_community_owner(username, community_id) or 
            is_community_admin(username, community_id))

if not USE_MYSQL:
    init_db()
    ensure_indexes()

def ensure_admin_member_of_all():
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            # Get admin id
            c.execute("SELECT id FROM users WHERE username='admin'")
            row = c.fetchone()
            if not row:
                return
            admin_id = row[0]
            # Get all communities
            c.execute("SELECT id FROM communities")
            comms = [r[0] if not isinstance(r, dict) else r['id'] for r in c.fetchall()]
            for cid in comms:
                c.execute("SELECT 1 FROM user_communities WHERE user_id=? AND community_id=?", (admin_id, cid))
                if not c.fetchone():
                    c.execute("INSERT INTO user_communities (user_id, community_id, joined_at) VALUES (?, ?, ?)", (admin_id, cid, datetime.now().strftime('%Y-%m-%d %H:%M:%S')))
            conn.commit()
    except Exception as e:
        logger.error(f"ensure_admin_member_of_all error: {e}")

ensure_admin_member_of_all()

# Initialize database on application startup
try:
    ensure_database_exists()
    logger.info("Database initialized successfully on startup")
except Exception as e:
    logger.error(f"Failed to initialize database on startup: {e}")
    print(f"WARNING: Database initialization failed on startup: {e}")

# Register the format_date Jinja2 filter
@app.template_filter('format_date')
def format_date(date_str, format_str):
    try:
        # Try multiple date formats
        for date_format in ['%m.%d.%y %H:%M', '%Y-%m-%d %H:%M:%S', '%Y-%m-%d %H:%M']:
            try:
                dt = datetime.strptime(date_str, date_format)
                return dt.strftime(format_str)
            except ValueError:
                continue
        # If none of the formats work, log error and return original
        logger.error(f"Invalid date format: {date_str}")
        return date_str
    except Exception as e:
        logger.error(f"Error formatting date {date_str}: {str(e)}")
        return date_str

# --- File upload helpers ---
def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def save_uploaded_file(file, subfolder=None):
    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        # Add timestamp to make filename unique
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        name, ext = os.path.splitext(filename)
        unique_filename = f"{name}_{timestamp}{ext}"
        
        # Create subfolder if specified
        if subfolder:
            upload_path = os.path.join(app.config['UPLOAD_FOLDER'], subfolder)
            os.makedirs(upload_path, exist_ok=True)
            filepath = os.path.join(upload_path, unique_filename)
            return_path = f"uploads/{subfolder}/{unique_filename}"
        else:
            filepath = os.path.join(app.config['UPLOAD_FOLDER'], unique_filename)
            return_path = f"uploads/{unique_filename}"
        
        file.save(filepath)
        return return_path
    return None

def generate_join_code():
    """Generate a unique 6-character join code for communities"""
    import random
    import string
    
    while True:
        # Generate a 6-character code with letters and numbers
        code = ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))
        
        # Check if code already exists
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT id FROM communities WHERE join_code = ?", (code,))
            if not c.fetchone():
                return code

# --- CSRF helpers ---
def get_csrf_token():
    """Temporarily disabled CSRF token generation"""
    return "disabled"

def validate_csrf():
    """Temporarily disabled CSRF validation"""
    return True




# Utility functions
def check_api_limit(username):
    today = datetime.now().strftime('%Y-%m-%d')
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT count FROM api_usage WHERE username=? AND date=?", (username, today))
            result = c.fetchone()
            count = result['count'] if result else 0
            if count >= DAILY_API_LIMIT:
                return False
            if count == 0:
                c.execute("INSERT INTO api_usage (username, date, count) VALUES (?, ?, 1)", (username, today))
            else:
                c.execute("UPDATE api_usage SET count=? WHERE username=? AND date=?", (count + 1, username, today))
            conn.commit()
            return True
    except Exception as e:
        logger.error(f"Error checking API limit for {username}: {str(e)}")
        abort(500)

def is_blood_test_related(message):
    blood_keywords = ['blood', 'test', 'results', 'lab', 'hemoglobin', 'glucose', 'cholesterol', 'triglycerides', 'iron',
                      'vitamin', 'hormone', 'testosterone', 'cortisol', 'thyroid', 'platelets', 'rbc', 'wbc', 'lipid']
    return any(keyword in message.lower() for keyword in blood_keywords)

def is_nutrition_related(message):
    nutrition_keywords = ['plan', 'diet', 'nutrition', 'calories', 'protein', 'fat', 'carb', 'carbs', 'meal', 'food']
    return any(keyword in message.lower() for keyword in nutrition_keywords)

# Decorators
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'username' not in session:
            logger.info("No username in session, redirecting to index")
            return redirect(url_for('index'))
        return f(*args, **kwargs)
    return decorated_function

def business_login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'business_id' not in session:
            return redirect(url_for('business_login'))
        return f(*args, **kwargs)
    return decorated_function

# Routes
@app.route('/', methods=['GET', 'POST'])
# @csrf.exempt
def index():
    print("Entering index route")
    logger.info(f"Request method: {request.method}")
    if request.method == 'POST':
        username = (request.form.get('username') or '').strip()
        print(f"Received username: {username}")
        logger.info(f"Received username: {username}")

        # Determine if request is from a mobile device
        ua = request.headers.get('User-Agent', '')
        is_mobile = any(k in ua for k in ['Mobi', 'Android', 'iPhone', 'iPad'])

        if not username:
            print("Username missing or empty")
            logger.warning("Username missing or empty")
            if is_mobile:
                # Redirect to React mobile page with error message
                return redirect(url_for('index', error='Please enter a username!'))
            return render_template('index.html', error="Please enter a username!")

        # Validate username exists in database
        try:
            with get_db_connection() as conn:
                c = conn.cursor()
                c.execute("SELECT 1 FROM users WHERE username=? LIMIT 1", (username,))
                exists = c.fetchone() is not None
        except Exception as e:
            logger.error(f"Database error validating username '{username}': {e}")
            if is_mobile:
                return redirect(url_for('index', error='Server error. Please try again.'))
            return render_template('index.html', error="Server error. Please try again.")

        if not exists:
            print("Username does not exist")
            logger.warning(f"Username not found: {username}")
            if is_mobile:
                return redirect(url_for('index', error='Username does not exist'))
            return render_template('index.html', error="Username does not exist")

        # Set long-lived session on initial username step
        session.permanent = True
        session['username'] = username
        print(f"Session username set to: {session['username']}")
        logger.info(f"Session username set to: {session['username']}")
        return redirect(url_for('login_password'))
    # GET request: Desktop -> HTML template, Mobile -> React (if available)
    try:
        ua = request.headers.get('User-Agent', '')
        is_mobile = any(k in ua for k in ['Mobi', 'Android', 'iPhone', 'iPad'])
        if is_mobile:
            try:
                base_dir = os.path.dirname(os.path.abspath(__file__))
                dist_dir = os.path.join(base_dir, 'client', 'dist')
                index_path = os.path.join(dist_dir, 'index.html')
                if os.path.exists(index_path):
                    return send_from_directory(dist_dir, 'index.html')
            except Exception as e:
                logger.warning(f"React mobile index not available: {e}")
        print("Rendering index.html for GET request (desktop or React missing)")
        return render_template('index.html')
    except Exception as e:
        logger.error(f"Error in / route: {str(e)}")
        return ("Internal Server Error", 500)

@app.route('/login_x')
def login_x():
    # X/Twitter OAuth is not configured yet
    # To enable this feature, you need to:
    # 1. Register your app at https://developer.twitter.com/
    # 2. Get API keys (consumer key and secret)
    # 3. Install authlib: pip install authlib
    # 4. Configure OAuth in the app
    flash('Sign in with X is not available yet. This feature requires API configuration.', 'error')
    return redirect(url_for('index'))
    # When configured, uncomment the following:
    # return x_auth.authorize(callback=url_for('authorized', _external=True))

@app.route('/callback')
def authorized():
    # This is the OAuth callback route for X/Twitter login
    # Currently disabled as OAuth is not configured
    flash('Sign in with X is not available yet. This feature requires API configuration.', 'error')
    return redirect(url_for('index'))
    
    # When OAuth is configured, uncomment the following:
    # try:
    #     resp = x_auth.authorized_response()
    #     if resp is None or resp.get('access_token') is None:
    #         error_msg = request.args.get('error_description', 'Unknown error')
    #         return render_template('index.html', error=f"Login failed: {error_msg}")
    #     session['x_token'] = (resp['access_token'], '')
    #     headers = {'Authorization': f"Bearer {resp['access_token']}"}
    #     user_info = requests.get('https://api.x.com/2/users/me', headers=headers, params={'user.fields': 'username'})
    #     if user_info.status_code != 200:
    #         return render_template('index.html', error=f"X API error: {user_info.text}")
    #     user_data = user_info.json()['data']
    #     username = user_data['username']
    #     with get_db_connection() as conn:
    #         c = conn.cursor()
    #         c.execute("SELECT subscription FROM users WHERE username=?", (username,))
    #         user = c.fetchone()
    #         if not user:
    #             c.execute("INSERT INTO users (username, subscription, password) VALUES (?, 'free', ?)",
    #                       (username, 'default_password'))
    #             conn.commit()
    #     session['username'] = username
    #     return redirect(url_for('premium_dashboard') if user and user['subscription'] == 'premium' else url_for('dashboard'))
    # except Exception as e:
    #     logger.error(f"Error in authorized route: {str(e)}")
    #     abort(500)
@app.route('/signup', methods=['GET', 'POST'])
# @csrf.exempt
def signup():
    """User registration page"""
    if request.method == 'GET':
        return render_template('signup.html')
    
    # Handle POST request for user registration (new compact form)
    full_name = request.form.get('full_name', '').strip()
    email = request.form.get('email', '').strip()
    mobile = request.form.get('mobile', '').strip()
    password = request.form.get('password', '')
    confirm_password = request.form.get('confirm_password', '')
    
    # Split full name into first and last names
    first_name = ''
    last_name = ''
    if full_name:
        parts = full_name.split()
        first_name = parts[0]
        last_name = ' '.join(parts[1:]) if len(parts) > 1 else ''
    
    # Validation
    if not all([full_name, email, password, confirm_password]):
        return render_template('signup.html', error='All required fields must be filled',
                               full_name=full_name, email=email, mobile=mobile)
    
    if password != confirm_password:
        return render_template('signup.html', error='Passwords do not match',
                               full_name=full_name, email=email, mobile=mobile)
    
    if len(password) < 6:
        return render_template('signup.html', error='Password must be at least 6 characters long',
                               full_name=full_name, email=email, mobile=mobile)
    
    # Username will be generated automatically
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Check if email already exists
            c.execute("SELECT 1 FROM users WHERE email = ?", (email,))
            if c.fetchone():
                return render_template('signup.html', error='Email already registered',
                                       full_name=full_name, email=email, mobile=mobile)
            
            # Generate a unique username based on email or name
            base_username = (email.split('@')[0] if email else (first_name + last_name)).lower()
            base_username = re.sub(r'[^a-z0-9_]', '', base_username) or 'user'
            username = base_username
            suffix = 1
            while True:
                c.execute("SELECT 1 FROM users WHERE username = ?", (username,))
                if not c.fetchone():
                    break
                suffix += 1
                username = f"{base_username}{suffix}"
            
            # Hash the password
            hashed_password = generate_password_hash(password)
            
            # Insert new user
            c.execute("""
                INSERT INTO users (username, email, password, first_name, last_name, age, gender, primary_goal, subscription, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'free', ?)
            """, (username, email, hashed_password, first_name, last_name, None, '', '', datetime.now().strftime('%m.%d.%y %H:%M')))
            
            # Store mobile if provided
            if mobile:
                c.execute("UPDATE users SET mobile = ? WHERE username = ?", (mobile, username))
            
            conn.commit()
            
            # Log the user in automatically and persist session
            session.permanent = True
            session['username'] = username
            session['user_id'] = c.lastrowid
            # Show community join prompt on first dashboard visit after signup
            session['show_join_community_prompt'] = True
            
            return redirect(url_for('dashboard'))
            
    except Exception as e:
        logger.error(f"Error during user registration: {str(e)}")
        return render_template('signup.html', error='An error occurred during registration. Please try again.',
                               full_name=full_name, email=email, mobile=mobile)

@app.route('/admin_profile')
@login_required
def admin_profile():
    """Admin profile page - only accessible to admin user"""
    username = session.get('username')
    
    # Check if user is admin
    if username != 'admin':
        abort(403)  # Forbidden - only admin can access this page
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Get admin information including profile picture
            c.execute("""
                SELECT u.username, u.email, u.first_name, u.last_name, u.subscription, u.created_at,
                       p.profile_picture
                FROM users u
                LEFT JOIN user_profiles p ON u.username = p.username
                WHERE u.username = ?
            """, (username,))
            admin_info = dict(c.fetchone())
            
            # Get system statistics
            c.execute("SELECT COUNT(*) as count FROM users")
            total_users = c.fetchone()['count']
            
            c.execute("SELECT COUNT(*) as count FROM posts")
            total_posts = c.fetchone()['count']
            
            c.execute("SELECT COUNT(*) as count FROM communities")
            total_communities = c.fetchone()['count']
            
            c.execute("SELECT COUNT(*) as count FROM users WHERE subscription = 'premium'")
            premium_users = c.fetchone()['count']
            
            stats = {
                'total_users': total_users,
                'total_posts': total_posts,
                'total_communities': total_communities,
                'premium_users': premium_users
            }
            
        return render_template('admin_profile.html', admin_info=admin_info, stats=stats)
        
    except Exception as e:
        logger.error(f"Error loading admin profile: {str(e)}")
        abort(500)

@app.route('/logout')
def logout():
    # Explicitly clear and mark session non-permanent
    session.clear()
    session.permanent = False
    # Clear remember token cookie
    from flask import make_response
    resp = make_response(redirect(url_for('index')))
    resp.set_cookie('remember_token', '', max_age=0, path='/', domain=os.getenv('SESSION_COOKIE_DOMAIN') or None)
    return resp
@app.route('/login_password', methods=['GET', 'POST'])
# @csrf.exempt
def login_password():
    print("Entering login_password route")
    if 'username' not in session:
        print("No username in session, redirecting to /")
        return redirect(url_for('index'))
    username = session['username']
    print(f"Username from session: {username}")
    if request.method == 'POST':
        password = request.form.get('password', '')
        print(f"Password entered: {password}")
        if username == 'admin' and password == '12345':
            print("Hardcoded admin match, redirecting to premium_dashboard")
            return redirect(url_for('premium_dashboard'))
        try:
            conn = get_db_connection()
            c = conn.cursor()
            try:
                c.execute("SELECT password, subscription, is_active FROM users WHERE username=?", (username,))
                row = c.fetchone()
            except Exception:
                # Fallback if is_active column does not exist in MySQL
                c.execute("SELECT password, subscription FROM users WHERE username=?", (username,))
                r2 = c.fetchone()
                row = (r2[0], r2[1], 1) if r2 else None
            user = row
            conn.close()
            print(f"DB query result: user found = {user is not None}")
            if user:
                stored_password = user[0] if isinstance(user, (list, tuple)) else user['password']
                subscription = user[1] if isinstance(user, (list, tuple)) else user.get('subscription')
                is_active = (user[2] if isinstance(user, (list, tuple)) else user.get('is_active', 1)) or 1
                
                # Check if user is deactivated
                if not is_active:
                    flash('Your account has been deactivated. Please contact the administrator.', 'error')
                    session.clear()
                    return redirect(url_for('index'))
                
                # Check if password is hashed (bcrypt hashes start with $2b$, $2a$, or $2y$)
                # or scrypt/pbkdf2 hashes from werkzeug start with 'scrypt:' or 'pbkdf2:'
                if stored_password and (stored_password.startswith('$') or stored_password.startswith('scrypt:') or stored_password.startswith('pbkdf2:')):
                    # Password is hashed, use check_password_hash
                    password_correct = check_password_hash(stored_password, password)
                    print(f"Using hashed password check, result: {password_correct}")
                    print(f"Hash type detected: {stored_password[:10]}...")
                else:
                    # Password is plain text (legacy), direct comparison
                    password_correct = (stored_password == password)
                    print(f"Using plain text password check, result: {password_correct}")
                
                if password_correct:
                    print(f"Password matches, subscription: {subscription}")
                    
                    # Track login
                    try:
                        conn = get_db_connection()
                        c = conn.cursor()
                        c.execute("""
                            INSERT INTO user_login_history (username, login_time, ip_address, user_agent)
                            VALUES (?, ?, ?, ?)
                        """, (username, datetime.now().isoformat(), 
                              request.remote_addr, 
                              request.headers.get('User-Agent', '')))
                        conn.commit()
                        conn.close()
                    except Exception as e:
                        logger.error(f"Error tracking login: {e}")
                    
                    # Ensure session persists for 30 days after successful login
                    session.permanent = True
                    # Issue remember-me token
                    from flask import make_response
                    resp = make_response(redirect(url_for('premium_dashboard' if subscription == 'premium' else 'dashboard')))
                    _issue_remember_token(resp, username)
                    return resp
                    
                else:
                    print("Password mismatch")
                    return render_template('login.html', username=username, error="Incorrect password. Please try again.")
            else:
                print("User not found")
                return render_template('login.html', username=username, error="Incorrect password. Please try again.")
        except Exception as e:
            print(f"Database error: {str(e)}")
            logger.error(f"Database error in login_password for {username}: {str(e)}")
            abort(500)
    print("Rendering login.html for GET request")
    return render_template('login.html', username=username)

@app.route('/dashboard')
@login_required
def dashboard():
    username = session['username']
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT subscription FROM users WHERE username=?", (username,))
            user = c.fetchone()
            
            # Get user's communities
            c.execute("""
                SELECT c.id, c.name, c.type
                FROM communities c
                JOIN user_communities uc ON c.id = uc.community_id
                JOIN users u ON uc.user_id = u.id
                WHERE u.username = ?
                ORDER BY c.name
            """, (username,))
            communities = [{'id': row['id'], 'name': row['name'], 'type': row['type']} for row in c.fetchall()]
            
        # Determine if we should show the first-time join community prompt
        show_join_prompt = session.pop('show_join_community_prompt', False)
        
        if user['subscription'] == 'premium':
            return redirect(url_for('premium_dashboard'))
        return render_template('dashboard.html', name=username, communities=communities, show_join_prompt=show_join_prompt)
    except Exception as e:
        logger.error(f"Error in dashboard for {username}: {str(e)}")
        abort(500)

@app.route('/free_workouts')
@login_required
def free_workouts():
    return render_template('free_workouts.html', name=session['username'])

@app.route('/premium_dashboard')
@login_required
def premium_dashboard():
    # Smart route: Desktop -> HTML template, Mobile -> React (if available)
    try:
        ua = request.headers.get('User-Agent', '')
        is_mobile = any(k in ua for k in ['Mobi', 'Android', 'iPhone', 'iPad'])
        if is_mobile:
            try:
                base_dir = os.path.dirname(os.path.abspath(__file__))
                dist_dir = os.path.join(base_dir, 'client', 'dist')
                index_path = os.path.join(dist_dir, 'index.html')
                if os.path.exists(index_path):
                    return send_from_directory(dist_dir, 'index.html')
            except Exception as e:
                logger.warning(f"React Premium Dashboard not available: {e}")
        # Desktop or React missing -> HTML template
        return render_template('premium_dashboard.html', name=session.get('username',''))
    except Exception as e:
        logger.error(f"Error in premium_dashboard: {str(e)}")
        return ("Internal Server Error", 500)

@app.route('/assets/<path:filename>')
def react_assets(filename):
    try:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        assets_dir = os.path.join(base_dir, 'client', 'dist', 'assets')
        asset_path = os.path.join(assets_dir, filename)
        if os.path.exists(asset_path):
            return send_from_directory(assets_dir, filename)
        logger.warning(f"React asset not found: {asset_path}")
        abort(404)
    except Exception as e:
        logger.error(f"Error serving React asset {filename}: {str(e)}")
        abort(404)

@app.route('/vite.svg')
def vite_svg():
    try:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        dist_dir = os.path.join(base_dir, 'client', 'dist')
        return send_from_directory(dist_dir, 'vite.svg')
    except Exception as e:
        logger.error(f"Error serving vite.svg: {str(e)}")
        abort(404)

@app.route('/sw.js')
def service_worker():
    try:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        dist_dir = os.path.join(base_dir, 'client', 'dist')
        return send_from_directory(dist_dir, 'sw.js')
    except Exception as e:
        logger.error(f"Error serving sw.js: {str(e)}")
        abort(404)

@app.route('/manifest.webmanifest')
def pwa_manifest():
    try:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        public_dir = os.path.join(base_dir, 'client', 'public')
        return send_from_directory(public_dir, 'manifest.webmanifest')
    except Exception as e:
        logger.error(f"Error serving manifest: {str(e)}")
        abort(404)

@app.route('/premium_dashboard_react')
@login_required
def premium_dashboard_react():
    try:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        dist_dir = os.path.join(base_dir, 'client', 'dist')
        return send_from_directory(dist_dir, 'index.html')
    except Exception as e:
        logger.error(f"Error serving React premium dashboard: {str(e)}")
        abort(500)

@app.route('/saved_workouts')
@login_required
def saved_workouts():
    username = session['username']
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT subscription FROM users WHERE username=?", (username,))
            user = c.fetchone()
            if not user:
                logger.error(f"User {username} not found in database")
                return render_template('index.html', error="User not found!")
            if user['subscription'] != 'premium':
                logger.warning(f"User {username} attempted to access saved_workouts without premium subscription")
                return redirect(url_for('dashboard'))
            c.execute("SELECT id, workout, timestamp, week, weights FROM saved_workouts WHERE username=? ORDER BY timestamp DESC", (username,))
            raw_workouts = c.fetchall()
            logger.debug(f"Raw workouts for {username}: {raw_workouts}")
        processed_workouts = []
        for workout in raw_workouts:
            try:
                logger.debug(f"Processing workout {workout['id']}: {workout}")
                weights = json.loads(workout['weights'] or '[]')
                logger.debug(f"Parsed weights for workout {workout['id']}: {weights}")
                exercises = []
                lines = workout['workout'].replace('\r\n', '<br>').split('<br>')
                for i, line in enumerate(lines):
                    line = line.strip()
                    if '<b>' in line and '</b>' in line and "Hey" not in line:
                        name = line.replace('<b>', '').replace('</b>', '')
                        if i + 1 < len(lines):
                            next_line = lines[i + 1].strip()
                            parts = next_line.split(', ')
                            sets, reps = '', ''
                            for part in parts:
                                if part.startswith('Sets:'): sets = part.replace('Sets: ', '')
                                elif part.startswith('Reps:'): reps = part.replace('Reps: ', '')
                            weight_data = weights[len(exercises)]['session'] if len(exercises) < len(weights) else []
                            exercises.append({
                                'name': name,
                                'sets': sets,
                                'reps': reps,
                                'weights': weight_data
                            })
                processed_workouts.append({
                    'id': workout['id'],
                    'timestamp': workout['timestamp'],
                    'week': workout['week'],
                    'exercises': exercises
                })
                logger.debug(f"Processed workout {workout['id']}: {processed_workouts[-1]}")
            except (ValueError, IndexError) as e:
                logger.error(f"Error processing workout {workout['id']} for {username}: {str(e)}")
                continue
        logger.info(f"Rendering {len(processed_workouts)} workouts for {username}")
        logger.debug(f"Final processed workouts: {processed_workouts}")
        return render_template('saved_workouts.html', name=username, workouts=processed_workouts, subscription=user['subscription'])
    except Exception as e:
        logger.error(f"Exception in /saved_workouts for {username}: {str(e)}")
        abort(500)

@app.route('/generate_workout_page')
@login_required
def generate_workout_page():
    username = session['username']
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT subscription FROM users WHERE username=?", (username,))
            user = c.fetchone()
        if not user or user['subscription'] != 'premium':
            return redirect(url_for('dashboard'))
        return render_template('generate_workouts.html', name=username, subscription=user['subscription'])
    except Exception as e:
        logger.error(f"Error in generate_workout_page for {username}: {str(e)}")
        abort(500)

@app.route('/choose_workout_type')
@login_required
def choose_workout_type():
    username = session['username']
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT subscription FROM users WHERE username=?", (username,))
            user = c.fetchone()
        if not user or user['subscription'] != 'premium':
            return redirect(url_for('dashboard'))
        return render_template('choose_workout_type.html', name=username, subscription=user['subscription'])
    except Exception as e:
        logger.error(f"Error in choose_workout_type for {username}: {str(e)}")
        abort(500)

@app.route('/build_workout_page')
@login_required
def build_workout_page():
    username = session['username']
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT subscription FROM users WHERE username=?", (username,))
            user = c.fetchone()
        if not user or user['subscription'] != 'premium':
            return redirect(url_for('dashboard'))
        muscle_splits = list(workout_data.keys())
        return render_template('build_workout.html', name=username, subscription=user['subscription'], muscle_splits=muscle_splits)
    except Exception as e:
        logger.error(f"Error in build_workout_page for {username}: {str(e)}")
        abort(500)

@app.route('/get_exercises', methods=['GET'])
@login_required
def get_exercises():
    username = session['username']
    muscle_or_split = request.args.get('muscle_or_split')
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT subscription FROM users WHERE username=?", (username,))
            user = c.fetchone()
        if not user or user['subscription'] != 'premium':
            return jsonify({'error': 'Premium subscription required.'}), 403
        if not muscle_or_split or muscle_or_split not in workout_data:
            return jsonify({'error': 'Invalid or missing muscle group/split.'}), 400
        exercises = []
        for training_type in workout_data[muscle_or_split]:
            for variation in workout_data[muscle_or_split][training_type]:
                for exercise in variation:
                    if exercise not in exercises:
                        exercises.append(exercise)
        return jsonify({'exercises': exercises})
    except Exception as e:
        logger.error(f"Error in get_exercises for {username}: {str(e)}")
        return jsonify({'error': 'Server error. Please try again later.'}), 500

@app.route('/save_workout', methods=['POST'])
@login_required
def save_workout():
    username = session['username']
    workout = request.form.get('workout')
    if not workout:
        return jsonify({'error': 'No workout provided!'}), 400
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT subscription FROM users WHERE username=?", (username,))
            user = c.fetchone()
            if not user or user['subscription'] != 'premium':
                return jsonify({'error': 'Premium subscription required!'}), 403
            exercise_count = sum(1 for line in workout.split('<br>') if '<b>' in line and '</b>' in line) - 1
            initial_weights = json.dumps([{"session": [], "weight": ""} for _ in range(exercise_count)])
            timestamp = datetime.now().strftime('%m.%d.%y')
            c.execute("INSERT INTO saved_workouts (username, workout, timestamp, weights) VALUES (?, ?, ?, ?)",
                      (username, workout, timestamp, initial_weights))
            workout_id = c.lastrowid
            conn.commit()
        logger.info(f"Workout saved for {username} with ID {workout_id}")
        return jsonify({'success': True, 'message': 'Workout saved successfully'}), 200
    except Exception as e:
        logger.error(f"Error in save_workout for {username}: {str(e)}")
        return jsonify({'error': f'Unexpected error: {str(e)}'}), 500

@app.route('/saved_workout_detail/<int:workout_id>')
@login_required
def saved_workout_detail(workout_id):
    username = session['username']
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT subscription FROM users WHERE username=?", (username,))
            user = c.fetchone()
            if not user or user['subscription'] != 'premium':
                logger.warning(f"User {username} attempted to access saved_workout_detail without premium subscription")
                return redirect(url_for('dashboard'))
            c.execute("SELECT workout, timestamp, week, weights FROM saved_workouts WHERE id=? AND username=?", (workout_id, username))
            workout = c.fetchone()
            if not workout:
                logger.error(f"Workout {workout_id} not found for user {username}")
                return render_template('index.html', error="Workout not found or unauthorized!")
            weights = json.loads(workout['weights'] or '[]')
            exercises = []
            lines = workout['workout'].replace('\r\n', '<br>').split('<br>')
            for i, line in enumerate(lines):
                line = line.strip()
                if '<b>' in line and '</b>' in line and "Hey" not in line:
                    name = line.replace('<b>', '').replace('</b>', '')
                    if i + 1 < len(lines):
                        next_line = lines[i + 1].strip()
                        parts = next_line.split(', ')
                        sets, reps = '', ''
                        for part in parts:
                            if part.startswith('Sets:'): sets = part.replace('Sets: ', '')
                            elif part.startswith('Reps:'): reps = part.replace('Reps: ', '')
                        weight_data = weights[len(exercises)]['session'] if len(exercises) < len(weights) else []
                        exercises.append({
                            'name': name,
                            'sets': sets,
                            'reps': reps,
                            'weights': weight_data
                        })
            workout_data = {
                'id': workout_id,
                'timestamp': workout['timestamp'],
                'week': workout['week'],
                'exercises': exercises
            }
        logger.info(f"Rendering saved workout detail for {username}, workout ID {workout_id}")
        return render_template('saved_workout_detail.html', name=username, workout=workout_data, subscription=user['subscription'])
    except Exception as e:
        logger.error(f"Error in saved_workout_detail for {username}, workout ID {workout_id}: {str(e)}")
        abort(500)

@app.route('/update_weight', methods=['POST'])
@login_required
def update_weight():
    username = session['username']
    workout_id = request.form.get('workout_id')
    exercise_index = request.form.get('exercise_index', type=int)
    week = request.form.get('week', type=int, default=1)
    weight = request.form.get('weight', '').strip()
    if not all([workout_id, weight]):
        logger.error(f"Missing required fields for {username}: {request.form}")
        return jsonify({'success': False, 'error': 'Missing workout ID or weight.'}), 400
    logger.debug(f"Update weight request for {username}: {request.form}")
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT subscription FROM users WHERE username=?", (username,))
            user = c.fetchone()
            if not user or user['subscription'] != 'premium':
                logger.error(f"User {username} lacks premium subscription for weight update")
                return jsonify({'success': False, 'error': 'Premium subscription required.'}), 403
            c.execute("SELECT weights FROM saved_workouts WHERE id=? AND username=?", (workout_id, username))
            result = c.fetchone()
            if not result:
                logger.error(f"Workout {workout_id} not found or unauthorized for {username}")
                return jsonify({'success': False, 'error': 'Workout not found or unauthorized.'}), 404
            weights = json.loads(result['weights'] or '[]')
            if not isinstance(weights, list):
                weights = []
            while len(weights) <= exercise_index:
                weights.append({"session": [], "weight": ""})
            weights[exercise_index]["session"].append({
                "number": len(weights[exercise_index]["session"]) + 1,
                "weight": weight,
                "date": datetime.now().strftime('%d.%m.%y')
            })
            logger.debug(f"Updated weights: {weights}")
            c.execute("UPDATE saved_workouts SET weights=?, week=? WHERE id=? AND username=?",
                      (json.dumps(weights), week, workout_id, username))
            conn.commit()
            logger.info(f"Weight updated successfully for {username}, workout {workout_id}, exercise {exercise_index}")
            return jsonify({
                'success': True,
                'weight': weight,
                'session_number': len(weights[exercise_index]["session"]),
                'date': datetime.now().strftime('%d.%m.%y')
            }), 200
    except Exception as e:
        logger.error(f"Error updating weight for {username}: {str(e)}")
        return jsonify({'success': False, 'error': f'Unexpected error: {str(e)}'}), 500

# Old delete_workout route removed - replaced with new one below

@app.route('/delete_weight', methods=['POST'])
@login_required
def delete_weight():
    username = session['username']
    workout_id = request.form.get('workout_id')
    exercise_index = request.form.get('exercise_index', type=int)
    session_number = request.form.get('session_number', type=int)
    logger.debug(f"Delete weight request for {username}: {request.form}")
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT subscription FROM users WHERE username=?", (username,))
            user = c.fetchone()
            if not user or user['subscription'] != 'premium':
                logger.error(f"User {username} lacks premium subscription for weight deletion")
                return jsonify({'success': False, 'error': 'Premium subscription required.'}), 403
            c.execute("SELECT weights FROM saved_workouts WHERE id=? AND username=?", (workout_id, username))
            result = c.fetchone()
            if not result:
                logger.error(f"Workout {workout_id} not found or unauthorized for {username}")
                return jsonify({'success': False, 'error': 'Workout not found or unauthorized.'}), 404
            weights = json.loads(result['weights'] or '[]')
            if not isinstance(weights, list) or exercise_index >= len(weights):
                logger.error(f"Invalid exercise index for {username}, workout {workout_id}, exercise {exercise_index}")
                return jsonify({'success': False, 'error': 'Invalid exercise index.'}), 400
            if not weights[exercise_index]["session"]:
                logger.error(f"No weights found for exercise {exercise_index} in workout {workout_id} for {username}")
                return jsonify({'success': False, 'error': 'No weights available for this exercise.'}), 400
            original_sessions = weights[exercise_index]["session"]
            weights[exercise_index]["session"] = [w for w in original_sessions if w["number"] != session_number]
            if len(weights[exercise_index]["session"]) == len(original_sessions):
                logger.error(f"Session number {session_number} not found for exercise {exercise_index} in workout {workout_id} for {username}")
                return jsonify({'success': False, 'error': 'Session number not found.'}), 400
            c.execute("UPDATE saved_workouts SET weights=? WHERE id=? AND username=?", (json.dumps(weights), workout_id, username))
            conn.commit()
            logger.info(f"Weight deleted successfully for {username}, workout {workout_id}, exercise {exercise_index}")
            return jsonify({'success': True, 'message': 'Weight deleted successfully'}), 200
    except json.JSONDecodeError as e:
        logger.error(f"JSON error deleting weight for {username}: {str(e)}")
        return jsonify({'success': False, 'error': 'Invalid weight data format.'}), 500
    except Exception as e:
        logger.error(f"Error deleting weight for {username}: {str(e)}")
        return jsonify({'success': False, 'error': f'Unexpected error: {str(e)}'}), 500
@app.route('/admin', methods=['GET', 'POST'])
@login_required
def admin():
    print(f"Admin route accessed by user: {session.get('username')}")
    if session['username'] != 'admin':
        print("User is not admin, redirecting")
        return redirect(url_for('index'))
    print("User is admin, proceeding")
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Get statistics
            c.execute("SELECT COUNT(*) FROM users")
            total_users = c.fetchone()[0]
            
            c.execute("SELECT COUNT(*) FROM users WHERE subscription = 'premium'")
            premium_users = c.fetchone()[0]
            
            c.execute("SELECT COUNT(*) FROM communities")
            total_communities = c.fetchone()[0]
            
            c.execute("SELECT COUNT(*) FROM posts")
            total_posts = c.fetchone()[0]
            
            stats = {
                'total_users': total_users,
                'premium_users': premium_users,
                'total_communities': total_communities,
                'total_posts': total_posts
            }
            
            # Get users list with is_active status
            c.execute("SELECT username, subscription, is_active FROM users ORDER BY username")
            users = c.fetchall()
            
            # Get all communities with member counts and is_active status
            c.execute("""
                SELECT c.id, c.name, c.type, c.creator_username, c.join_code,
                       COUNT(uc.user_id) as member_count, c.is_active
                FROM communities c
                LEFT JOIN user_communities uc ON c.id = uc.community_id
                GROUP BY c.id, c.name, c.type, c.creator_username, c.join_code, c.is_active
                ORDER BY c.name
            """)
            communities_raw = c.fetchall()
            
            # Convert to list of dictionaries for easier template access
            communities = []
            for community in communities_raw:
                communities.append({
                    'id': community[0],
                    'name': community[1],
                    'type': community[2],
                    'creator_username': community[3],
                    'join_code': community[4],
                    'member_count': community[5],
                    'is_active': community[6] if len(community) > 6 else True
                })
            
            if request.method == 'POST':
                if 'add_user' in request.form:
                    new_username = request.form.get('new_username')
                    new_password = request.form.get('new_password')
                    new_subscription = request.form.get('new_subscription')
                    try:
                        c.execute("INSERT INTO users (username, subscription, password) VALUES (?, ?, ?)",
                                  (new_username, new_subscription, new_password))
                        conn.commit()
                        # Refresh users list
                        c.execute("SELECT username, subscription, is_active FROM users ORDER BY username")
                        users = c.fetchall()
                    except sqlite3.IntegrityError:
                        return render_template('admin.html', users=users, communities=communities, stats=stats, error=f"Username {new_username} already exists!")
                        
                elif 'update_user' in request.form:
                    user_to_update = request.form.get('username')
                    new_subscription = request.form.get('subscription')
                    c.execute("UPDATE users SET subscription=? WHERE username=?", (new_subscription, user_to_update))
                    conn.commit()
                    # Refresh users list
                    c.execute("SELECT username, subscription, is_active FROM users ORDER BY username")
                    users = c.fetchall()
                    
                elif 'update_subscription' in request.form:
                    user_to_update = request.form.get('username')
                    new_subscription = request.form.get('new_subscription')
                    c.execute("UPDATE users SET subscription=? WHERE username=?", (new_subscription, user_to_update))
                    conn.commit()
                    # Refresh users list
                    c.execute("SELECT username, subscription, is_active FROM users ORDER BY username")
                    users = c.fetchall()
                    
                elif 'delete_user' in request.form:
                    user_to_delete = request.form.get('username')
                    
                    # Prevent admin from deleting themselves
                    if user_to_delete == 'admin':
                        return render_template('admin.html', users=users, communities=communities, stats=stats, error="Cannot delete admin user!")
                    
                    try:
                        # Delete user's data from all related tables
                        c.execute("DELETE FROM posts WHERE username=?", (user_to_delete,))
                        c.execute("DELETE FROM replies WHERE username=?", (user_to_delete,))
                        c.execute("DELETE FROM reactions WHERE username=?", (user_to_delete,))
                        c.execute("DELETE FROM reply_reactions WHERE username=?", (user_to_delete,))
                        c.execute("DELETE FROM user_communities WHERE user_id=(SELECT rowid FROM users WHERE username=?)", (user_to_delete,))
                        c.execute("DELETE FROM saved_data WHERE username=?", (user_to_delete,))
                        c.execute("DELETE FROM messages WHERE sender=?", (user_to_delete,))
                        c.execute("DELETE FROM messages WHERE receiver=?", (user_to_delete,))
                        
                        # Finally delete the user
                        c.execute("DELETE FROM users WHERE username=?", (user_to_delete,))
                        conn.commit()
                        
                        # Refresh users list
                        c.execute("SELECT username, subscription, is_active FROM users ORDER BY username")
                        users = c.fetchall()
                        
                    except Exception as delete_error:
                        logger.error(f"Error deleting user {user_to_delete}: {str(delete_error)}")
                        return render_template('admin.html', users=users, communities=communities, stats=stats, error=f"Error deleting user: {str(delete_error)}")
                        
                elif 'delete_community' in request.form:
                    community_id = request.form.get('community_id')
                    
                    try:
                        # Delete all posts in this community
                        c.execute("DELETE FROM posts WHERE community_id=?", (community_id,))
                        
                        # Delete all user_community entries for this community
                        c.execute("DELETE FROM user_communities WHERE community_id=?", (community_id,))
                        
                        # Delete the community itself
                        c.execute("DELETE FROM communities WHERE id=?", (community_id,))
                        conn.commit()
                        
                        # Refresh communities list
                        c.execute("""
                            SELECT c.id, c.name, c.type, c.creator_username, c.join_code,
                                   COUNT(uc.user_id) as member_count
                            FROM communities c
                            LEFT JOIN user_communities uc ON c.id = uc.community_id
                            GROUP BY c.id, c.name, c.type, c.creator_username, c.join_code
                            ORDER BY c.name
                        """)
                        communities_raw = c.fetchall()
                        
                        # Convert to list of dictionaries
                        communities = []
                        for community in communities_raw:
                            communities.append({
                                'id': community[0],
                                'name': community[1],
                                'type': community[2],
                                'creator_username': community[3],
                                'join_code': community[4],
                                'member_count': community[5]
                            })
                        
                    except Exception as delete_error:
                        logger.error(f"Error deleting community {community_id}: {str(delete_error)}")
                        return render_template('admin.html', users=users, communities=communities, stats=stats, error=f"Error deleting community: {str(delete_error)}")
            
        return render_template('admin.html', users=users, communities=communities, stats=stats)
        
    except Exception as e:
        logger.error(f"Error in admin route: {str(e)}")
        abort(500)

@app.route('/admin_test')
@login_required
def admin_test():
    if session['username'] != 'admin':
        return redirect(url_for('index'))
    return "Admin test route is working!"
                    

@app.route('/profile/<username>')
def public_profile(username):
    """Public profile page for any user"""
    logger.info(f"=== PROFILE ROUTE ACCESSED ===")
    logger.info(f"Username parameter: {username}")
    logger.info(f"Request URL: {request.url}")
    logger.info(f"Request path: {request.path}")
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Check if user exists
            c.execute("SELECT username FROM users WHERE username=?", (username,))
            user = c.fetchone()
            if not user:
                logger.warning(f"User not found: {username}")
                flash('User not found', 'error')
                return redirect(url_for('feed'))
            
            # Get profile data - LEFT JOIN ensures we get user data even if no profile exists
            c.execute("""
                SELECT u.username, u.email, u.subscription, u.age, u.gender, 
                       u.weight, u.height, u.blood_type, u.muscle_mass, u.bmi,
                       u.country, u.city, u.industry,
                       p.display_name, p.bio, p.location, p.website, 
                       p.instagram, p.twitter, p.profile_picture, p.cover_photo,
                       p.is_public
                FROM users u
                LEFT JOIN user_profiles p ON u.username = p.username
                WHERE u.username = ?
            """, (username,))
            
            profile_data = c.fetchone()
            
            # This should never happen if user exists (checked above)
            if not profile_data:
                logger.error(f"Critical: User exists but no data returned for: {username}")
                flash('Profile data error', 'error')
                return redirect(url_for('feed'))
                
            logger.info(f"Profile data found for {username}")
            
            # Get user's posts
            c.execute("""
                SELECT id, content, image_path, timestamp 
                FROM posts 
                WHERE username = ? 
                ORDER BY timestamp DESC 
                LIMIT 20
            """, (username,))
            posts = c.fetchall()
            
            # Get user's communities
            try:
                c.execute("""
                    SELECT c.id, c.name, c.description, c.accent_color
                    FROM communities c
                    JOIN user_communities uc ON c.id = uc.community_id
                    JOIN users u ON uc.user_id = u.id
                    WHERE u.username = ?
                    ORDER BY c.name
                """, (username,))
                communities = c.fetchall()
                logger.info(f"Found {len(communities)} communities for {username}")
            except Exception as e:
                logger.error(f"Error fetching communities for {username}: {str(e)}")
                communities = []  # Continue with empty communities list instead of failing
            
            # Check if viewing own profile
            is_own_profile = 'username' in session and session['username'] == username
            
            return render_template('public_profile.html',
                                 profile=profile_data,
                                 posts=posts,
                                 communities=communities,
                                 is_own_profile=is_own_profile,
                                 username=session.get('username'))
                                 
    except Exception as e:
        logger.error(f"Error loading profile for {username}: {str(e)}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        flash('Error loading profile', 'error')
        return redirect(url_for('feed'))

@app.route('/account_settings')
@login_required
def account_settings():
    """Account settings page for managing account info and password"""
    username = session['username']
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT username, email, subscription FROM users WHERE username=?", (username,))
            user = c.fetchone()
            
        if user:
            return render_template('account_settings.html', username=username, user=user)
        return render_template('index.html', error="User not found!")
    except Exception as e:
        logger.error(f"Error in account settings for {username}: {str(e)}")
        abort(500)

@app.route('/profile')
@login_required
def profile():
    username = session['username']
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Get user data and profile data
            c.execute("""
                SELECT u.username, u.email, u.subscription, u.age, u.gender, 
                       u.weight, u.height, u.blood_type, u.muscle_mass, u.bmi,
                       u.country, u.city, u.industry,
                       p.display_name, p.bio, p.location, p.website, 
                       p.instagram, p.twitter, p.profile_picture, p.cover_photo,
                       p.is_public,
                       u.role, u.company, u.degree, u.school, u.skills, 
                       u.linkedin, u.experience
                FROM users u
                LEFT JOIN user_profiles p ON u.username = p.username
                WHERE u.username = ?
            """, (username,))
            user = c.fetchone()
            
        if user:
            # Mobile -> React, Desktop -> HTML
            ua = request.headers.get('User-Agent', '')
            is_mobile = any(k in ua for k in ['Mobi', 'Android', 'iPhone', 'iPad'])
            if is_mobile:
                base_dir = os.path.dirname(os.path.abspath(__file__))
                dist_dir = os.path.join(base_dir, 'client', 'dist')
                return send_from_directory(dist_dir, 'index.html')
            return render_template('profile.html', username=username, user=user)
        return render_template('index.html', error="User profile not found!")
    except Exception as e:
        logger.error(f"Error in profile for {username}: {str(e)}")
        abort(500)

@app.route('/api/profile_me')
@login_required
def api_profile_me():
    username = session['username']
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("""
                SELECT u.username, u.email, u.subscription,
                       p.display_name, p.bio, p.location, p.website,
                       p.instagram, p.twitter, p.profile_picture, p.cover_photo
                FROM users u
                LEFT JOIN user_profiles p ON u.username = p.username
                WHERE u.username = ?
            """, (username,))
            row = c.fetchone()
            if not row:
                return jsonify({ 'success': False, 'error': 'not found' }), 404
            def get_val(key_or_idx):
                try:
                    return row[key_or_idx] if hasattr(row, 'keys') and (isinstance(key_or_idx, str) and key_or_idx in row.keys()) else row[key_or_idx]
                except Exception:
                    return None
            profile = {
                'username': username,
                'email': get_val('email') if isinstance(row, dict) or hasattr(row, 'keys') else row[1],
                'subscription': get_val('subscription') if isinstance(row, dict) or hasattr(row, 'keys') else row[2],
                'display_name': get_val('display_name') if isinstance(row, dict) or hasattr(row, 'keys') else row[3],
                'bio': get_val('bio') if isinstance(row, dict) or hasattr(row, 'keys') else row[4],
                'location': get_val('location') if isinstance(row, dict) or hasattr(row, 'keys') else row[5],
                'website': get_val('website') if isinstance(row, dict) or hasattr(row, 'keys') else row[6],
                'instagram': get_val('instagram') if isinstance(row, dict) or hasattr(row, 'keys') else row[7],
                'twitter': get_val('twitter') if isinstance(row, dict) or hasattr(row, 'keys') else row[8],
                'profile_picture': get_val('profile_picture') if isinstance(row, dict) or hasattr(row, 'keys') else row[9],
                'cover_photo': get_val('cover_photo') if isinstance(row, dict) or hasattr(row, 'keys') else row[10],
            }
            return jsonify({ 'success': True, 'profile': profile })
    except Exception as e:
        logger.error(f"Error in api_profile_me: {e}")
        return jsonify({ 'success': False, 'error': 'server error' }), 500
@app.route('/upload_logo', methods=['POST'])
@login_required
def upload_logo():
    """Upload a new logo (admin only)"""
    username = session.get('username')
    
    # Check if user is admin
    if username != 'admin':
        return jsonify({'success': False, 'error': 'Unauthorized'}), 403
    
    try:
        if 'logo' not in request.files:
            return jsonify({'success': False, 'error': 'No file provided'})
        
        file = request.files['logo']
        if file.filename == '':
            return jsonify({'success': False, 'error': 'No file selected'})
        
        if file and allowed_file(file.filename):
            # Save the logo file
            filename = 'logo.png'  # Always save as logo.png
            filepath = os.path.join('static', filename)
            file.save(filepath)
            
            return jsonify({
                'success': True,
                'logo_url': url_for('static', filename=filename)
            })
        else:
            return jsonify({'success': False, 'error': 'Invalid file type'})
            
    except Exception as e:
        logger.error(f"Error uploading logo: {str(e)}")
        return jsonify({'success': False, 'error': 'Server error'})

@app.route('/upload_signup_image', methods=['POST'])
@login_required
def upload_signup_image():
    """Upload the left-side signup image (admin only)"""
    username = session.get('username')
    if username != 'admin':
        return jsonify({'success': False, 'error': 'Unauthorized'}), 403
    try:
        if 'image' not in request.files:
            return jsonify({'success': False, 'error': 'No file provided'})
        file = request.files['image']
        if file.filename == '':
            return jsonify({'success': False, 'error': 'No file selected'})
        if file and allowed_file(file.filename):
            filename = 'signup_side.jpg'
            filepath = os.path.join('static', filename)
            file.save(filepath)
            return jsonify({'success': True, 'image_url': url_for('static', filename=filename)})
        return jsonify({'success': False, 'error': 'Invalid file type'})
    except Exception as e:
        logger.error(f"Error uploading signup image: {str(e)}")
        return jsonify({'success': False, 'error': 'Server error'})

@app.route('/check_profile_picture')
@login_required
def check_profile_picture():
    """Debug route to check profile picture status"""
    username = session['username']
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT profile_picture FROM user_profiles WHERE username=?", (username,))
            result = c.fetchone()
            if result:
                return f"Profile picture for {username}: {result['profile_picture']}"
            else:
                return f"No profile found for {username}"
    except Exception as e:
        return f"Error: {str(e)}"

@app.route('/update_public_profile', methods=['POST'])
@login_required
def update_public_profile():
    """Update public profile information"""
    username = session['username']
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Get form data
            display_name = request.form.get('display_name', '').strip()
            bio = request.form.get('bio', '').strip()
            location = request.form.get('location', '').strip()
            website = request.form.get('website', '').strip()
            instagram = request.form.get('instagram', '').strip()
            twitter = request.form.get('twitter', '').strip()
            is_public = 1 if request.form.get('is_public') == 'on' else 0
            
            # Handle profile picture upload
            profile_picture_path = None
            if 'profile_picture' in request.files:
                file = request.files['profile_picture']
                logger.info(f"Profile picture upload attempt for {username}: {file.filename if file else 'No file'}")
                
                if file and file.filename != '' and allowed_file(file.filename):
                    # Save the uploaded file
                    profile_picture_path = save_uploaded_file(file, subfolder='profile_pictures')
                    logger.info(f"Profile picture saved for {username}: {profile_picture_path}")
                    
                    # Get current profile picture to delete old one if exists
                    c.execute("SELECT profile_picture FROM user_profiles WHERE username=?", (username,))
                    old_profile = c.fetchone()
                    if old_profile and old_profile['profile_picture']:
                        # Delete old profile picture file
                        old_path = os.path.join('static', old_profile['profile_picture'])
                        if os.path.exists(old_path):
                            try:
                                os.remove(old_path)
                                logger.info(f"Deleted old profile picture: {old_path}")
                            except Exception as e:
                                logger.warning(f"Could not delete old profile picture: {e}")
            
            # Check if profile exists
            c.execute("SELECT username FROM user_profiles WHERE username=?", (username,))
            exists = c.fetchone()
            
            if exists:
                # Update existing profile
                if profile_picture_path:
                    c.execute("""
                        UPDATE user_profiles 
                        SET display_name=?, bio=?, location=?, website=?, 
                            instagram=?, twitter=?, is_public=?, 
                            profile_picture=?, updated_at=CURRENT_TIMESTAMP
                        WHERE username=?
                    """, (display_name, bio, location, website, instagram, 
                         twitter, is_public, profile_picture_path, username))
                    logger.info(f"Updated profile with picture for {username}: {profile_picture_path}")
                else:
                    c.execute("""
                        UPDATE user_profiles 
                        SET display_name=?, bio=?, location=?, website=?, 
                            instagram=?, twitter=?, is_public=?, 
                            updated_at=CURRENT_TIMESTAMP
                        WHERE username=?
                    """, (display_name, bio, location, website, instagram, 
                         twitter, is_public, username))
                    logger.info(f"Updated profile without picture for {username}")
            else:
                # Create new profile
                c.execute("""
                    INSERT INTO user_profiles 
                    (username, display_name, bio, location, website, 
                     instagram, twitter, is_public, profile_picture)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (username, display_name, bio, location, website, 
                     instagram, twitter, is_public, profile_picture_path))
                logger.info(f"Created new profile with picture for {username}: {profile_picture_path}")
            
            conn.commit()
            logger.info(f"Profile committed to database for {username}")
            flash('Public profile updated successfully!', 'success')
            
    except Exception as e:
        logger.error(f"Error updating public profile: {str(e)}")
        flash('Error updating profile', 'error')
    
    return redirect(url_for('profile'))

@app.route('/update_password', methods=['POST'])
@login_required
def update_password():
    username = session['username']
    current_password = request.form.get('current_password')
    new_password = request.form.get('new_password')
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT password FROM users WHERE username=?", (username,))
            user = c.fetchone()
            
            if not user:
                return jsonify({'success': False, 'error': 'User not found'})
            
            stored_password = user['password']
            
            # Check current password - handle both hashed and plain text
            if stored_password and (stored_password.startswith('$') or stored_password.startswith('scrypt:') or stored_password.startswith('pbkdf2:')):
                # Password is hashed
                if not check_password_hash(stored_password, current_password):
                    return jsonify({'success': False, 'error': 'Current password is incorrect'})
            else:
                # Password is plain text (legacy)
                if stored_password != current_password:
                    return jsonify({'success': False, 'error': 'Current password is incorrect'})
            
            # Hash the new password before storing
            hashed_password = generate_password_hash(new_password)
            c.execute("UPDATE users SET password=? WHERE username=?", (hashed_password, username))
            conn.commit()
            
            return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Error updating password for {username}: {str(e)}")
        return jsonify({'success': False, 'error': 'Server error'})

@app.route('/update_email', methods=['POST'])
@login_required
def update_email():
    username = session['username']
    new_email = request.form.get('new_email')
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Check if email is already taken
            c.execute("SELECT username FROM users WHERE email=? AND username!=?", (new_email, username))
            existing_user = c.fetchone()
            if existing_user:
                return jsonify({'success': False, 'error': 'Email is already in use'})
            
            c.execute("UPDATE users SET email=? WHERE username=?", (new_email, username))
            conn.commit()
            
            return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Error updating email for {username}: {str(e)}")
        return jsonify({'success': False, 'error': 'Server error'})

@app.route('/update_professional', methods=['POST'])
@login_required
def update_professional():
    """Update professional information"""
    username = session['username']
    try:
        role = request.form.get('role', '')
        company = request.form.get('company', '')
        industry = request.form.get('industry', '')
        degree = request.form.get('degree', '')
        school = request.form.get('school', '')
        skills = request.form.get('skills', '')
        linkedin = request.form.get('linkedin', '')
        experience = request.form.get('experience', type=int)
        
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("""UPDATE users SET role=?, company=?, industry=?, degree=?, school=?, 
                        skills=?, linkedin=?, experience=? WHERE username=?""",
                     (role, company, industry, degree, school, skills, linkedin, experience, username))
            conn.commit()
        
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Error updating professional info for {username}: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/update_personal_info', methods=['POST'])
@login_required
def update_personal_info():
    username = session['username']
    age = request.form.get('age')
    gender = request.form.get('gender')
    country = request.form.get('country')
    city = request.form.get('city')
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Convert age to appropriate type
            age = int(age) if age else None
            
            c.execute("""UPDATE users SET age=?, gender=?, country=?, city=? 
                        WHERE username=?""", (age, gender, country, city, username))
            conn.commit()
            
            return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Error updating personal info for {username}: {str(e)}")
        return jsonify({'success': False, 'error': 'Server error'})

@app.route('/edit_profile', methods=['GET', 'POST'])
@login_required
def edit_profile():
    username = session['username']
    try:
        if request.method == 'POST':
            gender = request.form.get('gender')
            weight = float(request.form.get('weight', 0)) if request.form.get('weight') else None
            height = float(request.form.get('height', 0)) if request.form.get('height') else None
            blood_type = request.form.get('blood_type')
            muscle_mass = float(request.form.get('muscle_mass', 0)) if request.form.get('muscle_mass') else None
            bmi = round(weight / ((height / 100) ** 2), 1) if weight and height else None
            with get_db_connection() as conn:
                c = conn.cursor()
                c.execute("UPDATE users SET gender=?, weight=?, height=?, blood_type=?, muscle_mass=?, bmi=? WHERE username=?",
                          (gender, weight, height, blood_type, muscle_mass, bmi, username))
                conn.commit()
            return redirect(url_for('profile'))
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT subscription, gender, weight, height, blood_type, muscle_mass FROM users WHERE username=?", (username,))
            user = c.fetchone()
        return render_template('edit_profile.html', name=username, subscription=user['subscription'], **dict(user))
    except Exception as e:
        logger.error(f"Error in edit_profile for {username}: {str(e)}")
        abort(500)

@app.route('/generate_workout', methods=['POST'])
@login_required
def generate_workout():
    username = session['username']
    muscle_or_split = request.form.get('muscle_or_split')
    training_type = request.form.get('training_type')
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT subscription FROM users WHERE username=?", (username,))
            user = c.fetchone()
        subscription = user['subscription'] if user else 'free'
        if not muscle_or_split or not training_type:
            return jsonify({'error': 'Please provide all details!'})
        try:
            variations = workout_data[muscle_or_split][training_type]
            if subscription == 'free':
                selected_program = variations[0][:1]
                workout_text = "Upgrade to Premium for more options!<br><br>"
            else:
                selected_program = random.choice(variations)
                workout_text = ""
            for exercise in selected_program:
                workout_text += f"<b>{exercise['name']}</b><br>Sets: {exercise['sets']}, Reps: {exercise['reps']}<br><br>"
            return jsonify({'workout': workout_text})
        except KeyError:
            return jsonify({'error': f'No data for {muscle_or_split} - {training_type}!'})
    except Exception as e:
        logger.error(f"Server error in generate_workout for {username}: {str(e)}")
        return jsonify({'error': 'Server error. Please try again later.'}), 500
@app.route('/blood_test_analysis', methods=['GET', 'POST'])
@login_required
def blood_test_analysis():
    username = session['username']
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT subscription FROM users WHERE username=?", (username,))
            user = c.fetchone()
        if not user or user['subscription'] != 'premium':
            return render_template('index.html', error="Premium subscription required!")
        if request.method == 'POST':
            action = request.form.get('action')
            if action == 'save' and 'response' in request.form:
                response = request.form['response']
                timestamp = datetime.now().strftime('%m.%d.%y')
                with get_db_connection() as conn:
                    c = conn.cursor()
                    c.execute("INSERT INTO saved_data (username, type, data, timestamp) VALUES (?, ?, ?, ?)",
                              (username, 'blood_test', response, timestamp))
                    conn.commit()
                return jsonify({'message': 'Blood test analysis saved!'})
            if not check_api_limit(username):
                return jsonify({'response': "Daily chat limit reached!"})
            message = request.form.get('message', '')
            file = request.files.get('file')
            combined_message = ""
            if file:
                file_content = file.read().decode('utf-8', errors='ignore')
                combined_message = f"Analyze this blood test: {file_content}"
            if message:
                combined_message = f"{message}\n{combined_message}" if combined_message else message
            if not combined_message:
                return jsonify({'response': "Please provide text or a file!"})
            if not is_blood_test_related(combined_message):
                return jsonify({'response': "This isn't about blood tests - try Nutrition instead!"})
            headers = {'Authorization': f'Bearer {XAI_API_KEY}', 'Content-Type': 'application/json'}
            payload = {
                'model': 'grok-beta',
                'messages': [
                    {'role': 'system', 'content': "You're Grok, built by xAI - analyze blood tests from a functional medicine perspective."},
                    {'role': 'user', 'content': combined_message}
                ],
                'max_tokens': 1000
            }
            try:
                response = requests.post(XAI_API_URL, headers=headers, json=payload)
                response.raise_for_status()
                grok_response = response.json()['choices'][0]['message']['content']
                return jsonify({'response': grok_response})
            except requests.RequestException as e:
                logger.error(f"API error in blood_test_analysis for {username}: {str(e)}")
                return jsonify({'error': 'API error. Please try again later.'}), 500
        return render_template('blood_test_analysis.html', name=username, subscription=user['subscription'])
    except Exception as e:
        logger.error(f"Error in blood_test_analysis for {username}: {str(e)}")
        abort(500)

@app.route('/chat', methods=['GET', 'POST'])
@login_required
def chat():
    username = session['username']
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT subscription FROM users WHERE username=?", (username,))
            user = c.fetchone()
        if not user or user['subscription'] != 'premium':
            return render_template('index.html', error="Premium subscription required!")
        if request.method == 'POST':
            if not check_api_limit(username):
                return jsonify({'response': "Daily chat limit reached!"})
            message = request.form.get('message', '')
            file = request.files.get('file')
            combined_message = ""
            if file:
                file_content = file.read().decode('utf-8', errors='ignore')
                combined_message = f"Here's some info: {file_content}"
            if message:
                combined_message = f"{message}\n{combined_message}" if combined_message else message
            if not combined_message:
                return jsonify({'response': "Please provide text or a file!"})
            headers = {'Authorization': f'Bearer {XAI_API_KEY}', 'Content-Type': 'application/json'}
            payload = {
                'model': 'grok-beta',
                'messages': [
                    {'role': 'system', 'content': "You're Grok, built by xAI - keep it helpful and redirect blood test or nutrition queries."},
                    {'role': 'user', 'content': combined_message}
                ],
                'max_tokens': 1000
            }
            try:
                response = requests.post(XAI_API_URL, headers=headers, json=payload)
                response.raise_for_status()
                grok_response = response.json()['choices'][0]['message']['content']
                return jsonify({'response': grok_response})
            except requests.RequestException as e:
                logger.error(f"API error in chat for {username}: {str(e)}")
                return jsonify({'error': 'API error. Please try again later.'}), 500
        return render_template('chat_with_grok.html', name=username, subscription=user['subscription'])
    except Exception as e:
        logger.error(f"Error in chat for {username}: {str(e)}")
        abort(500)

@app.route('/nutrition', methods=['GET', 'POST'])
@login_required
def nutrition():
    username = session['username']
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT subscription, gender, weight, height, nutrition_goal, nutrition_restrictions FROM users WHERE username=?", (username,))
            user = c.fetchone()
        if not user or user['subscription'] != 'premium':
            return render_template('index.html', error="Premium subscription required!")
        if request.method == 'POST':
            action = request.form.get('action')
            if action == 'save' and 'response' in request.form:
                response = request.form.get('response', '')
                if not response:
                    logger.error(f"No response provided for save action in /nutrition for {username}")
                    return jsonify({'error': 'No response provided to save.'}), 400
                timestamp = datetime.now().strftime('%m.%d.%y')
                with get_db_connection() as conn:
                    c = conn.cursor()
                    c.execute("INSERT INTO saved_data (username, type, data, timestamp) VALUES (?, ?, ?, ?)",
                              (username, 'nutrition', response, timestamp))
                    conn.commit()
                return jsonify({'message': 'Nutrition plan saved!'})
            if not check_api_limit(username):
                return jsonify({'response': "Daily chat limit reached!"})
            # Collect form inputs with fallback to user profile
            message = request.form.get('message', '')
            gender = request.form.get('gender', user['gender'] if user and user['gender'] else '')
            age = request.form.get('age', '')
            weight = request.form.get('weight', str(user['weight']) if user and user['weight'] else '')
            height = request.form.get('height', str(user['height']) if user and user['height'] else '')
            activity_level = request.form.get('activityLevel', '')
            nutrition_goal = request.form.get('nutritionGoal', user['nutrition_goal'] if user and user['nutrition_goal'] else '')
            restrictions = request.form.get('restrictions', user['nutrition_restrictions'] if user and user['nutrition_restrictions'] else '')
            # Construct user_data dictionary
            user_data = {
                'gender': gender,
                'age': age,
                'weight': weight,
                'height': height,
                'activity_level': activity_level,
                'nutrition_goal': nutrition_goal,
                'restrictions': restrictions,
                'meal_timing': '',
                'health_conditions': '',
                'budget': '',
                'cooking_skills': '',
                'favorite_foods': ''
            }
            # Log user data for debugging
            logger.debug(f"Received user data for Grok: {user_data}")
            # Construct the message for Grok
            combined_message = message or "Generate a nutrition plan based on my profile."
            combined_message += "\nHere is my profile information:\n"
            for key, value in user_data.items():
                if value and value.strip():
                    combined_message += f"- {key.replace('_', ' ').title()}: {value}\n"
            combined_message += "\nIf any information is missing (e.g., meal timing, health conditions, budget, cooking skills, favorite foods), assume reasonable defaults: 3 meals per day, no health conditions, moderate budget, beginner cooking skills, and a preference for savory flavors."
            # Log the final message sent to Grok
            logger.debug(f"Message sent to Grok: {combined_message}")
            if not is_nutrition_related(combined_message):
                return jsonify({'response': "Not nutrition-related - try Chat with Grok!"})
            headers = {'Authorization': f'Bearer {XAI_API_KEY}', 'Content-Type': 'application/json'}
            payload = {
                'model': 'grok-beta',
                'messages': [
                    {
                        'role': 'system',
                        'content': '''
                        You're Grok, built by xAI - create personalized nutrition plans based on the user's profile. Use the following information if provided:
                        - Gender (e.g., Male, Female, Non-binary, Prefer not to say)
                        - Age (e.g., 25 years)
                        - Weight (e.g., 150 lbs or 68 kg) 
                        - Height (e.g., 5'7" or 170 cm)
                        - Activity Level (e.g., Sedentary, Lightly active, Moderately active, Very active, Extremely active)
                        - Nutrition Goal (e.g., Lose weight, Gain muscle, Maintain current weight, Improve energy, Manage a specific health condition)
                        - Dietary Restrictions/Preferences (e.g., Vegetarian, Vegan, Gluten-free, Dairy-free, Nut allergies, Low-carb, Halal, Kosher)
                        - Meal Timing (e.g., 3 meals/day, 2 meals + 2 snacks)
                        - Health Conditions (e.g., Diabetes, Hypertension, Thyroid issues)
                        - Budget (e.g., Low, Moderate, High)
                        - Cooking Skills/Time (e.g., Beginner, Advanced, Limited time)
                        - Favorite Foods/Flavors (e.g., Spicy, Sweet, Savory)
                        If any information is missing, use the defaults specified in the message or ask the user for clarification. Format the nutrition plan with clear headers for days (e.g., "Day 1"), meals (e.g., "Breakfast," "Lunch," "Snack," "Dinner"), and detailed descriptions. Use simple, readable language and ensure the plan is balanced, healthy, and aligns with the user's goals and restrictions.
                        '''
                    },
                    {
                        'role': 'user',
                        'content': combined_message
                    }
                ],
                'max_tokens': 1500
            }
            try:
                response = requests.post(XAI_API_URL, headers=headers, json=payload)
                response.raise_for_status()
                grok_response = response.json()['choices'][0]['message']['content']
                return jsonify({'response': grok_response})
            except requests.RequestException as e:
                logger.error(f"API error in nutrition for {username}: {str(e)} with payload: {payload}")
                return jsonify({'error': 'API error. Please try again later.'}), 500
            except Exception as e:
                logger.error(f"Unexpected error in nutrition for {username}: {str(e)}")
                return jsonify({'error': 'Unexpected error. Please try again later.'}), 500
        return render_template('nutrition.html', name=username, subscription=user['subscription'])
    except Exception as e:
        logger.error(f"Error in nutrition for {username}: {str(e)}")
        abort(500)

@app.route('/nutrition_plan', methods=['GET', 'POST'])
@login_required
def nutrition_plan():
    username = session['username']
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT subscription, gender, weight, height, nutrition_goal, nutrition_restrictions FROM users WHERE username=?", (username,))
            user = c.fetchone()
        if not user or user['subscription'] != 'premium':
            return render_template('index.html', error="Premium subscription required!")
        if request.method == 'POST' and request.form.get('action') == 'new':
            return redirect(url_for('nutrition'))
        gender = user['gender'] or 'Male'
        goal = user['nutrition_goal'] or 'Weight Loss'
        restrictions = user['nutrition_restrictions'] or ''
        try:
            plan = nutrition_plans[gender][goal][restrictions]
            return render_template('nutrition_plan.html', name=username, plan=plan, goal=goal, restrictions=restrictions, subscription=user['subscription'])
        except KeyError:
            return render_template('index.html', error="No plan available - try chatting with Grok!")
    except Exception as e:
        logger.error(f"Error in nutrition_plan for {username}: {str(e)}")
        abort(500)

@app.route('/saved_nutrition')
@login_required
def saved_nutrition():
    username = session['username']
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT subscription FROM users WHERE username=?", (username,))
            user = c.fetchone()
            if not user:
                logger.error(f"User {username} not found in database")
                return render_template('index.html', error="User not found!")
            if user['subscription'] != 'premium':
                logger.warning(f"User {username} attempted to access saved_nutrition without premium subscription")
                return redirect(url_for('dashboard'))
            c.execute("SELECT data, timestamp FROM saved_data WHERE username=? AND type='nutrition' ORDER BY timestamp DESC", (username,))
            rows = c.fetchall()
            plans = [dict(row) for row in rows]
            logger.debug(f"Raw database rows for {username}: {rows}")
            logger.debug(f"Converted plans for {username}: {plans}")
            if not plans:
                logger.warning(f"No nutrition plans found for {username}")
        return render_template('saved_nutrition.html', plans=plans, name=username, subscription=user['subscription'])
    except sqlite3.Error as e:
        logger.error(f"Database error in saved_nutrition for {username}: {str(e)}")
        abort(500)
    except Exception as e:
        logger.error(f"Unexpected error in saved_nutrition for {username}: {str(e)}")
        abort(500)

@app.route('/delete_nutrition', methods=['POST'], endpoint='delete_nutrition_endpoint')
@login_required
def delete_nutrition():
    username = session['username']
    # Temporarily disable CSRF validation
    # if not validate_csrf():
    #     return jsonify({'success': False, 'error': 'Invalid CSRF token'}), 400
    timestamp = request.form.get('timestamp')
    if not timestamp:
        return jsonify({'success': False, 'error': 'Timestamp required!'})
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT subscription FROM users WHERE username=?", (username,))
            user = c.fetchone()
            if not user or user['subscription'] != 'premium':
                return jsonify({'success': False, 'error': 'Premium subscription required!'})
            c.execute("DELETE FROM saved_data WHERE username=? AND type='nutrition' AND timestamp=?", (username, timestamp))
            if c.rowcount == 0:
                return jsonify({'success': False, 'error': 'Nutrition plan not found!'})
            conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Error deleting nutrition for {username}: {str(e)}")
        abort(500)

@app.route('/health_news')
@login_required
def health_news():
    username = session['username']
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT subscription FROM users WHERE username=?", (username,))
            user = c.fetchone()
        if not user or user['subscription'] != 'premium':
            return render_template('index.html', error="Premium subscription required!")
        news_items = [
            {'title': 'Protein Boosts Gains', 'summary': 'More protein = more muscle.', 'source': 'ScienceDaily', 'source_url': 'https://www.sciencedaily.com', 'image_url': 'https://via.placeholder.com/150'},
            {'title': 'Keto vs. Paleo', 'summary': "Which diet wins? It's complicated.", 'source': 'HealthLine', 'source_url': 'https://www.healthline.com', 'image_url': 'https://via.placeholder.com/150'}
        ]
        return render_template('health_news.html', name=username, news_items=news_items, subscription=user['subscription'])
    except Exception as e:
        logger.error(f"Error in health_news for {username}: {str(e)}")
        abort(500)

@app.route('/subscribe', methods=['GET', 'POST'])
@login_required
def subscribe():
    username = session['username']
    if request.method == 'POST':
        plan = request.form['plan']
        if not stripe:
            return render_template('index.html', error="Stripe not configured!")
        try:
            price_id = 'price_monthly_id' if plan == 'monthly' else 'price_yearly_id'
            checkout_session = stripe.checkout.Session.create(
                payment_method_types=['card'],
                line_items=[{'price': price_id, 'quantity': 1}],
                mode='subscription',
                success_url=url_for('success', _external=True),
                cancel_url=url_for('subscribe', _external=True)
            )
            return redirect(checkout_session.url, code=303)
        except Exception as e:
            logger.error(f"Stripe error in subscribe for {username}: {str(e)}")
            abort(500)
    return render_template('subscribe.html', name=username)

@app.route('/success')
@login_required
def success():
    username = session['username']
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("UPDATE users SET subscription='premium' WHERE username=?", (username,))
            conn.commit()
        return render_template('success.html', name=username, subscription='premium')
    except Exception as e:
        logger.error(f"Error in success for {username}: {str(e)}")
        abort(500)



@app.route('/business_register', methods=['GET', 'POST'])
def business_register():
    if request.method == 'POST':
        name = request.form.get('name')
        email = request.form.get('email')
        password = request.form.get('password')
        address = request.form.get('address')
        phone = request.form.get('phone')
        type = request.form.get('type', 'gym')
        if name and email and password:
            try:
                with get_db_connection() as conn:
                    c = conn.cursor()
                    c.execute("SELECT email FROM businesses WHERE email=?", (email,))
                    if c.fetchone():
                        return render_template('index.html', error="Email already registered!")
                    c.execute("INSERT INTO businesses (name, email, password, address, phone, type) VALUES (?, ?, ?, ?, ?, ?)",
                              (name, email, password, address, phone, type))
                    conn.commit()
                return redirect(url_for('business_login'))
            except Exception as e:
                logger.error(f"Error in business_register: {str(e)}")
                abort(500)
        return render_template('index.html', error="Please fill all required fields!")
    return render_template('business_register.html')

@app.route('/business_login', methods=['GET', 'POST'])
def business_login():
    # Business login temporarily disabled
    flash('Business login is not available at this time.', 'error')
    return redirect(url_for('index'))
    
    # Original code preserved for future use:
    # if request.method == 'POST':
    #     email = request.form.get('email')
    #     password = request.form.get('password')
    #     try:
    #         with get_db_connection() as conn:
    #             c = conn.cursor()
    #             c.execute("SELECT business_id, name, password FROM businesses WHERE email=?", (email,))
    #             business = c.fetchone()
    #         if business and business['password'] == password:
    #             session['business_id'] = business['business_id']
    #             session['business_name'] = business['name']
    #             return redirect(url_for('business_dashboard'))
    #         return render_template('index.html', error="Invalid email or password!")
    #     except Exception as e:
    #         logger.error(f"Error in business_login: {str(e)}")
    #         abort(500)
    # return render_template('business_login.html')

@app.route('/business_dashboard')
@business_login_required
def business_dashboard():
    business_id = session['business_id']
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT name, email, address, phone, type FROM businesses WHERE business_id=?", (business_id,))
            business = c.fetchone()
            c.execute("SELECT u.username, m.membership_type, m.start_date, m.end_date, m.status FROM memberships m JOIN users u ON m.user_username = u.username WHERE m.business_id=?", (business_id,))
            memberships = c.fetchall()
        return render_template('business_dashboard.html', business=business, memberships=memberships)
    except Exception as e:
        logger.error(f"Error in business_dashboard for business {business_id}: {str(e)}")
        abort(500)

@app.route('/business_logout')
def business_logout():
    session.pop('business_id', None)
    session.pop('business_name', None)
    return redirect(url_for('business_login'))

@app.route('/delete_chat', methods=['POST'])
@login_required
def delete_chat():
    username = session['username']
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT subscription FROM users WHERE username=?", (username,))
            user = c.fetchone()
            if not user or user['subscription'] != 'premium':
                return jsonify({'success': False, 'error': 'Premium subscription required!'})
            receiver = request.form.get('receiver')
            if not receiver:
                return jsonify({'success': False, 'error': 'Receiver required!'})
            c.execute("DELETE FROM messages WHERE (sender=? AND receiver=?) OR (sender=? AND receiver=?)",
                      (username, receiver, receiver, username))
            deleted_count = c.rowcount
            conn.commit()
        return jsonify({'success': True, 'deleted_count': deleted_count})
    except Exception as e:
        logger.error(f"Error deleting chat for {username}: {str(e)}")
        abort(500)
@app.route('/get_messages', methods=['POST'])
@login_required
def get_messages():
    """Get messages between current user and another user"""
    username = session.get('username')
    other_user_id = request.form.get('other_user_id')
    
    if not other_user_id:
        return jsonify({'success': False, 'error': 'Other user ID required'})
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Get current user ID
            c.execute("SELECT id FROM users WHERE username = ?", (username,))
            user = c.fetchone()
            if not user:
                return jsonify({'success': False, 'error': 'User not found'})
            
            user_id = user['id'] if hasattr(user, 'keys') else user[0]
            
            # Get other user's username
            c.execute("SELECT username FROM users WHERE id = ?", (other_user_id,))
            other_user = c.fetchone()
            if not other_user:
                return jsonify({'success': False, 'error': 'Other user not found'})
            
            other_username = other_user['username'] if hasattr(other_user, 'keys') else other_user[0]
            
            # Get messages between users
            c.execute("""
                SELECT id, sender, receiver, message, image_path, timestamp
                FROM messages
                WHERE (sender = ? AND receiver = ?) 
                   OR (sender = ? AND receiver = ?)
                ORDER BY timestamp ASC
            """, (username, other_username, other_username, username))
            
            messages = []
            for msg in c.fetchall():
                messages.append({
                    'id': msg['id'],
                    'text': msg['message'],
                    'image_path': msg.get('image_path') if hasattr(msg, 'get') else msg[4],
                    'sent': msg['sender'] == username,
                    'time': msg['timestamp']
                })
            
            # Mark messages from other user as read
            c.execute("UPDATE messages SET is_read=1 WHERE sender=? AND receiver=? AND is_read=0", (other_username, username))
            conn.commit()
            return jsonify({'success': True, 'messages': messages})
            
    except Exception as e:
        logger.error(f"Error fetching messages: {str(e)}")
        return jsonify({'success': False, 'error': 'Failed to fetch messages'})

@app.route('/send_message', methods=['POST'])
@login_required
def send_message():
    """Send a message to another user"""
    username = session.get('username')
    recipient_id = request.form.get('recipient_id')
    message = request.form.get('message')
    
    if not recipient_id or not message:
        return jsonify({'success': False, 'error': 'Recipient and message required'})
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Get recipient username
            c.execute("SELECT username FROM users WHERE id = ?", (recipient_id,))
            recipient = c.fetchone()
            if not recipient:
                return jsonify({'success': False, 'error': 'Recipient not found'})
            
            recipient_username = recipient['username'] if hasattr(recipient, 'keys') else recipient[0]
            
            # Check for duplicate message in last 5 seconds to prevent double-sends
            c.execute("""
                SELECT id FROM messages 
                WHERE sender = ? AND receiver = ? AND message = ?
                AND timestamp > DATE_SUB(NOW(), INTERVAL 5 SECOND)
                LIMIT 1
            """, (username, recipient_username, message))
            
            if c.fetchone():
                # Duplicate message detected, return success but don't insert
                return jsonify({'success': True, 'message': 'Message already sent'})
            
            # Insert message
            c.execute("""
                INSERT INTO messages (sender, receiver, message, timestamp)
                VALUES (?, ?, ?, NOW())
            """, (username, recipient_username, message))
            
            conn.commit()
            
            # Create notification for the recipient (prevent duplicates)
            try:
                # Check for duplicate notification in last 10 seconds
                c.execute("""
                    SELECT id FROM notifications 
                    WHERE user_id = ? AND from_user = ? AND type = 'message'
                    AND created_at > DATE_SUB(NOW(), INTERVAL 10 SECOND)
                    LIMIT 1
                """, (recipient_username, username))
                
                if not c.fetchone():
                    c.execute("""
                        INSERT INTO notifications (user_id, from_user, type, message, created_at)
                        VALUES (?, ?, 'message', ?, NOW())
                    """, (recipient_username, username, f"New message from {username}"))
                    conn.commit()
            except Exception as notif_e:
                logger.warning(f"Could not create message notification: {notif_e}")
            
            # Push notification to recipient (if subscribed)
            try:
                send_push_to_user(recipient_username, {
                    'title': f'New message from {username}',
                    'body': message[:120],
                    'url': f'/user_chat/chat/{username}',
                })
            except Exception as _e:
                logger.warning(f"push send_message warn: {_e}")

            return jsonify({'success': True, 'message': 'Message sent successfully'})
            
    except Exception as e:
        logger.error(f"Error sending message: {str(e)}")
        return jsonify({'success': False, 'error': 'Failed to send message'})

@app.route('/send_photo_message', methods=['POST'])
@login_required
def send_photo_message():
    """Send a photo message to another user"""
    username = session.get('username')
    recipient_id = request.form.get('recipient_id')
    message = request.form.get('message', '')  # Optional text with photo
    
    if not recipient_id:
        return jsonify({'success': False, 'error': 'Recipient required'})
    
    # Check if photo was uploaded
    if 'photo' not in request.files:
        return jsonify({'success': False, 'error': 'No photo uploaded'})
    
    photo = request.files['photo']
    if photo.filename == '':
        return jsonify({'success': False, 'error': 'No photo selected'})
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Get recipient username
            c.execute("SELECT username FROM users WHERE id = ?", (recipient_id,))
            recipient = c.fetchone()
            if not recipient:
                return jsonify({'success': False, 'error': 'Recipient not found'})
            
            recipient_username = recipient['username'] if hasattr(recipient, 'keys') else recipient[0]
            
            # Save the photo
            import uuid
            from werkzeug.utils import secure_filename
            
            # Generate unique filename
            file_extension = photo.filename.rsplit('.', 1)[1].lower() if '.' in photo.filename else 'jpg'
            unique_filename = f"message_{uuid.uuid4().hex[:12]}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.{file_extension}"
            
            # Ensure uploads directory exists
            uploads_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads', 'message_photos')
            os.makedirs(uploads_dir, exist_ok=True)
            
            # Save file
            file_path = os.path.join(uploads_dir, unique_filename)
            photo.save(file_path)
            
            # Store relative path for database
            relative_path = f"message_photos/{unique_filename}"
            
            # Check for duplicate message in last 5 seconds
            c.execute("""
                SELECT id FROM messages 
                WHERE sender = ? AND receiver = ? AND image_path = ?
                AND timestamp > DATE_SUB(NOW(), INTERVAL 5 SECOND)
                LIMIT 1
            """, (username, recipient_username, relative_path))
            
            if c.fetchone():
                # Duplicate photo message detected
                return jsonify({'success': True, 'message': 'Photo already sent'})
            
            # Insert photo message
            c.execute("""
                INSERT INTO messages (sender, receiver, message, image_path, timestamp)
                VALUES (?, ?, ?, ?, NOW())
            """, (username, recipient_username, message, relative_path))
            
            conn.commit()
            
            # Create notification for the recipient
            try:
                c.execute("""
                    SELECT id FROM notifications 
                    WHERE user_id = ? AND from_user = ? AND type = 'message'
                    AND created_at > DATE_SUB(NOW(), INTERVAL 10 SECOND)
                    LIMIT 1
                """, (recipient_username, username))
                
                if not c.fetchone():
                    notification_text = f"📷 {username} sent a photo" + (f": {message}" if message else "")
                    c.execute("""
                        INSERT INTO notifications (user_id, from_user, type, message, created_at)
                        VALUES (?, ?, 'message', ?, NOW())
                    """, (recipient_username, username, notification_text))
                    conn.commit()
            except Exception as notif_e:
                logger.warning(f"Could not create photo message notification: {notif_e}")
            
            # Push notification
            try:
                notification_body = f"📷 Photo" + (f": {message}" if message else "")
                send_push_to_user(recipient_username, {
                    'title': f'New message from {username}',
                    'body': notification_body,
                    'url': f'/user_chat/chat/{username}',
                })
            except Exception as _e:
                logger.warning(f"push send_photo_message warn: {_e}")

            return jsonify({
                'success': True, 
                'message': 'Photo sent successfully',
                'image_path': relative_path
            })
            
    except Exception as e:
        logger.error(f"Error sending photo message: {str(e)}")
        return jsonify({'success': False, 'error': 'Failed to send photo'})

@app.route('/api/chat_threads')
@login_required
def api_chat_threads():
    """Return list of chat threads for the current user with avatar and last message sent by the user.
    Shape: { success, threads: [ { other_username, display_name, profile_picture_url, last_sent_text, last_sent_time, last_activity_time } ] }
    """
    username = session.get('username')
    try:
        with get_db_connection() as conn:
            c = conn.cursor()

            # Gather all counterpart usernames the user has messages with (either direction)
            c.execute(
                """
                SELECT DISTINCT receiver AS other_username
                FROM messages
                WHERE sender = ?
                UNION
                SELECT DISTINCT sender AS other_username
                FROM messages
                WHERE receiver = ?
                ORDER BY other_username
                """,
                (username, username),
            )
            counterpart_rows = c.fetchall()

            threads = []
            for row in counterpart_rows:
                try:
                    other_username = row['other_username'] if isinstance(row, dict) or hasattr(row, 'keys') else row[0]

                    # Last message in either direction (preview)
                    c.execute(
                        """
                        SELECT message, timestamp, sender
                        FROM messages
                        WHERE (sender = ? AND receiver = ?) OR (sender = ? AND receiver = ?)
                        ORDER BY timestamp DESC
                        LIMIT 1
                        """,
                        (username, other_username, other_username, username),
                    )
                    last_row = c.fetchone()
                    last_message_text = None
                    last_activity_time = None
                    last_sender = None
                    if last_row:
                        if hasattr(last_row, 'keys'):
                            last_message_text = last_row['message']
                            last_activity_time = last_row['timestamp']
                            last_sender = last_row['sender']
                        else:
                            last_message_text = last_row[0]
                            last_activity_time = last_row[1]
                            last_sender = last_row[2]

                    # Unread count for this thread (messages sent by other -> me)
                    c.execute("SELECT COUNT(*) as count FROM messages WHERE sender=? AND receiver=? AND is_read=0", (other_username, username))
                    unread_row = c.fetchone()
                    unread_count = unread_row['count'] if hasattr(unread_row, 'keys') else (unread_row[0] if unread_row else 0)

                    # Profile info (avatar)
                    c.execute(
                        "SELECT display_name, profile_picture FROM user_profiles WHERE username = ?",
                        (other_username,),
                    )
                    profile = c.fetchone()
                    display_name = None
                    profile_picture_rel = None
                    if profile:
                        if hasattr(profile, 'keys') and 'display_name' in profile.keys():
                            display_name = profile['display_name']
                        else:
                            try:
                                display_name = profile[0]
                            except Exception:
                                display_name = None
                        if hasattr(profile, 'keys') and 'profile_picture' in profile.keys():
                            profile_picture_rel = profile['profile_picture']
                        else:
                            try:
                                profile_picture_rel = profile[1]
                            except Exception:
                                profile_picture_rel = None
                    display_name = display_name or other_username

                    profile_picture_url = url_for('static', filename=profile_picture_rel) if profile_picture_rel else None

                    threads.append({
                        'other_username': other_username,
                        'display_name': display_name,
                        'profile_picture_url': profile_picture_url,
                        'last_message_text': last_message_text,
                        'last_activity_time': last_activity_time,
                        'last_sender': last_sender,
                        'unread_count': int(unread_count or 0),
                    })
                except Exception as inner_e:
                    logger.warning(f"Failed to build thread for counterpart: {inner_e}")
                    continue

        # Sort threads by most recent activity; filter out any without counterpart
        threads = [t for t in threads if t.get('other_username')]
        threads.sort(key=lambda t: (t.get('last_activity_time') or ''), reverse=True)
        return jsonify({'success': True, 'threads': threads})
    except Exception as e:
        logger.error(f"Error building chat threads for {username}: {e}")
        return jsonify({'success': False, 'error': 'Failed to load chats'}), 500

@app.route('/user_chat')
@login_required
def user_chat():
    username = session['username']
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT subscription FROM users WHERE username=?", (username,))
            user = c.fetchone()
            if not user or user['subscription'] != 'premium':
                return render_template('index.html', error="Premium subscription required!")
            
            # Smart UA: mobile -> SPA, desktop -> HTML
            ua = request.headers.get('User-Agent', '')
            is_mobile = any(k in ua for k in ['Mobi', 'Android', 'iPhone', 'iPad'])
            if is_mobile:
                base_dir = os.path.dirname(os.path.abspath(__file__))
                dist_dir = os.path.join(base_dir, 'client', 'dist')
                return send_from_directory(dist_dir, 'index.html')
            
            # Desktop: render HTML with context
            c.execute("""
                SELECT c.id, c.name, c.type, c.creator_username
                FROM communities c
                INNER JOIN user_communities uc ON c.id = uc.community_id
                INNER JOIN users u ON uc.user_id = u.id
                WHERE u.username = ?
                ORDER BY c.name
            """, (username,))
            communities = c.fetchall()
            
            community_members = {}
            for community in communities:
                c.execute("""
                    SELECT DISTINCT u.username
                    FROM user_communities uc
                    INNER JOIN users u ON uc.user_id = u.id
                    WHERE uc.community_id = ? AND u.username != ?
                    ORDER BY u.username
                """, (community[0], username))
                members = [row[0] for row in c.fetchall()]
                community_members[community[0]] = members
            
            all_community_members = set()
            for community in communities:
                c.execute("""
                    SELECT DISTINCT u.username
                    FROM user_communities uc
                    INNER JOIN users u ON uc.user_id = u.id
                    WHERE uc.community_id = ? AND u.username != ?
                    ORDER BY u.username
                """, (community[0], username))
                members = [row[0] for row in c.fetchall()]
                all_community_members.update(members)
            
            all_users = sorted(list(all_community_members))
            
        return render_template('user_chat.html', name=username, users=all_users, communities=communities, community_members=community_members, subscription=user['subscription'])
    except Exception as e:
        logger.error(f"Error in user_chat for {username}: {str(e)}")
        abort(500)

@app.route('/user_chat/<path:subpath>')
@login_required
def user_chat_subpath(subpath):
    try:
        ua = request.headers.get('User-Agent', '')
        is_mobile = any(k in ua for k in ['Mobi', 'Android', 'iPhone', 'iPad'])
        if is_mobile:
            base_dir = os.path.dirname(os.path.abspath(__file__))
            dist_dir = os.path.join(base_dir, 'client', 'dist')
            return send_from_directory(dist_dir, 'index.html')
        return redirect(url_for('user_chat'))
    except Exception:
        return redirect(url_for('user_chat'))

@app.route('/delete_message', methods=['POST'])
@login_required
def delete_message():
    username = session['username']
    message_id = request.form.get('message_id')
    if not message_id:
        return jsonify({'success': False, 'error': 'Message ID required'})
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT subscription FROM users WHERE username=?", (username,))
            user = c.fetchone()
            if not user or user['subscription'] != 'premium':
                return jsonify({'success': False, 'error': 'Premium subscription required!'})
            c.execute("DELETE FROM messages WHERE id=? AND (sender=? OR receiver=?)",
                      (message_id, username, username))
            if c.rowcount == 0:
                return jsonify({'success': False, 'error': 'Message not found or not yours'})
            conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Error deleting message for {username}: {str(e)}")
        return jsonify({'success': False, 'error': 'Failed to delete message'}), 500

@app.route('/delete_chat_thread', methods=['POST'])
@login_required
def delete_chat_thread():
    """Delete all messages between the current user and the specified other user"""
    username = session['username']
    other_username = request.form.get('other_username')
    if not other_username:
        return jsonify({'success': False, 'error': 'Other username required'})
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            # Optional: restrict to premium similar to delete_message
            c.execute("SELECT subscription FROM users WHERE username=?", (username,))
            user = c.fetchone()
            if not user or (hasattr(user, 'keys') and user['subscription'] != 'premium') or (not hasattr(user, 'keys') and user[0] != 'premium'):
                return jsonify({'success': False, 'error': 'Premium subscription required!'})

            c.execute(
                """
                DELETE FROM messages
                WHERE (sender=? AND receiver=?) OR (sender=? AND receiver=?)
                """,
                (username, other_username, other_username, username),
            )
            conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"delete_chat_thread error for {username} with {other_username}: {e}")
        return jsonify({'success': False, 'error': 'Failed to delete chat'}), 500
@app.route('/get_community_members', methods=['POST'])
@login_required
def get_community_members():
    username = session['username']
    community_id = request.form.get('community_id')
    if not community_id:
        return jsonify({'success': False, 'error': 'No community ID specified'})
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            # Check if user is a member of this community - ALL members can see member list
            c.execute("""
                SELECT 1 FROM user_communities uc
                INNER JOIN users u ON uc.user_id = u.id
                WHERE uc.community_id = ? AND u.username = ?
            """, (community_id, username))
            if not c.fetchone():
                return jsonify({'success': False, 'error': 'Not a member of this community'})
            
            # Get community owner
            c.execute("SELECT creator_username FROM communities WHERE id = ?", (community_id,))
            community = c.fetchone()
            creator_username = community['creator_username'] if community else None
            
            # Get all members of the community with their roles
            c.execute("""
                SELECT u.username, uc.joined_at, up.profile_picture
                FROM user_communities uc
                INNER JOIN users u ON uc.user_id = u.id
                LEFT JOIN user_profiles up ON up.username = u.username
                WHERE uc.community_id = ?
                ORDER BY u.username
            """, (community_id,))
            
            members = []
            for row in c.fetchall():
                member_username = row['username']
                joined_date = row['joined_at'] if row['joined_at'] else 'Unknown'
                profile_picture = row['profile_picture'] if 'profile_picture' in row.keys() else None
                
                # Determine role
                role = 'member'
                if member_username == creator_username:
                    role = 'owner'
                else:
                    # Check if admin
                    c.execute("SELECT 1 FROM community_admins WHERE community_id = ? AND username = ?",
                             (community_id, member_username))
                    if c.fetchone():
                        role = 'admin'
                
                members.append({
                    'username': member_username,
                    'joined_date': joined_date,
                    'role': role,
                    'is_owner': member_username == creator_username,
                    'is_admin': role == 'admin',
                    'profile_picture': profile_picture
                })
            
            # Check current user's role
            current_user_role = 'member'
            if username == creator_username:
                current_user_role = 'owner'
            elif username == 'admin':
                current_user_role = 'app_admin'
            else:
                c.execute("SELECT 1 FROM community_admins WHERE community_id = ? AND username = ?",
                         (community_id, username))
                if c.fetchone():
                    current_user_role = 'admin'
            
        return jsonify({
            'success': True, 
            'members': members,
            'current_user_role': current_user_role,
            'creator_username': creator_username
        })
    except Exception as e:
        logger.error(f"Error getting community members for {username}: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/add_community_member', methods=['POST'])
@login_required
def add_community_member():
    username = session['username']
    community_id = request.form.get('community_id')
    new_member_username = request.form.get('username')
    if not community_id or not new_member_username:
        return jsonify({'success': False, 'error': 'Missing required parameters'})
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            # Check if user is community owner or admin
            c.execute("SELECT creator_username FROM communities WHERE id = ?", (community_id,))
            community = c.fetchone()
            if not community:
                return jsonify({'success': False, 'error': 'Community not found'})
            
            if username != community['creator_username'] and username != 'admin':
                return jsonify({'success': False, 'error': 'Only community owner or admin can add members'})
            
            # Check if new member exists
            c.execute("SELECT rowid FROM users WHERE username = ?", (new_member_username,))
            new_member = c.fetchone()
            if not new_member:
                return jsonify({'success': False, 'error': 'User not found'})
            
            # Check if already a member
            c.execute("""
                SELECT 1 FROM user_communities uc
                INNER JOIN users u ON uc.user_id = u.id
                WHERE uc.community_id = ? AND u.username = ?
            """, (community_id, new_member_username))
            if c.fetchone():
                return jsonify({'success': False, 'error': 'User is already a member'})
            
            # Add member
            c.execute("INSERT INTO user_communities (community_id, user_id, joined_at) VALUES (?, ?, ?)",
                      (community_id, new_member['rowid'], datetime.now().strftime('%Y-%m-%d %H:%M:%S')))
            conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Error adding community member for {username}: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/update_member_role', methods=['POST'])
@login_required
def update_member_role():
    """Update a member's role (make admin, remove admin, transfer ownership)"""
    username = session['username']
    community_id = request.form.get('community_id')
    target_username = request.form.get('target_username')
    new_role = request.form.get('new_role')  # 'admin', 'member', 'owner'
    
    if not all([community_id, target_username, new_role]):
        return jsonify({'success': False, 'error': 'Missing required parameters'})
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Get community info
            c.execute("SELECT creator_username FROM communities WHERE id = ?", (community_id,))
            community = c.fetchone()
            if not community:
                return jsonify({'success': False, 'error': 'Community not found'})
            
            current_owner = community['creator_username']
            
            # Check permissions
            is_app_admin = username == 'admin'
            is_owner = username == current_owner
            
            # Check if current user is community admin
            c.execute("SELECT 1 FROM community_admins WHERE community_id = ? AND username = ?",
                     (community_id, username))
            is_community_admin = c.fetchone() is not None
            
            # Permission checks based on action
            if new_role == 'owner':
                # Only app admin can transfer ownership
                if not is_app_admin:
                    return jsonify({'success': False, 'error': 'Only app admin can transfer ownership'})
                
                # Update community owner
                c.execute("UPDATE communities SET creator_username = ? WHERE id = ?",
                         (target_username, community_id))
                
                # Remove new owner from admins if they were one
                c.execute("DELETE FROM community_admins WHERE community_id = ? AND username = ?",
                         (community_id, target_username))
                
                # Make old owner an admin (unless they're the app admin)
                if current_owner != 'admin' and current_owner != target_username:
                    c.execute("""INSERT IGNORE INTO community_admins 
                               (community_id, username, appointed_by, appointed_at)
                               VALUES (?, ?, ?, ?)""",
                             (community_id, current_owner, username, datetime.now().isoformat()))
                
            elif new_role == 'admin':
                # Owner or app admin can make admins
                if not (is_owner or is_app_admin):
                    return jsonify({'success': False, 'error': 'Only owner or app admin can appoint admins'})
                
                # Can't make owner an admin
                if target_username == current_owner:
                    return jsonify({'success': False, 'error': 'Owner cannot be made an admin'})
                
                # Add as admin
                c.execute("""INSERT IGNORE INTO community_admins 
                           (community_id, username, appointed_by, appointed_at)
                           VALUES (?, ?, ?, ?)""",
                         (community_id, target_username, username, datetime.now().isoformat()))
                
            elif new_role == 'member':
                # Remove admin role
                # Owner or app admin can remove admins
                if not (is_owner or is_app_admin):
                    return jsonify({'success': False, 'error': 'Only owner or app admin can remove admins'})
                
                c.execute("DELETE FROM community_admins WHERE community_id = ? AND username = ?",
                         (community_id, target_username))
            
            else:
                return jsonify({'success': False, 'error': 'Invalid role specified'})
            
            conn.commit()
            return jsonify({'success': True, 'message': f'Role updated successfully'})
            
    except Exception as e:
        logger.error(f"Error updating member role: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/remove_community_member', methods=['POST'])
@login_required
def remove_community_member():
    username = session['username']
    community_id = request.form.get('community_id')
    member_username = request.form.get('username')
    if not community_id or not member_username:
        return jsonify({'success': False, 'error': 'Missing required parameters'})
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            # Check if user is community owner or admin
            c.execute("SELECT creator_username FROM communities WHERE id = ?", (community_id,))
            community = c.fetchone()
            if not community:
                return jsonify({'success': False, 'error': 'Community not found'})
            
            if username != community['creator_username'] and username != 'admin':
                return jsonify({'success': False, 'error': 'Only community owner or admin can remove members'})
            
            # Prevent removing the owner
            if member_username == community['creator_username']:
                return jsonify({'success': False, 'error': 'Cannot remove community owner'})
            
            # Get member's user ID
            c.execute("SELECT rowid FROM users WHERE username = ?", (member_username,))
            member = c.fetchone()
            if not member:
                return jsonify({'success': False, 'error': 'User not found'})
            
            # Remove member
            c.execute("DELETE FROM user_communities WHERE community_id = ? AND user_id = ?",
                      (community_id, member['rowid']))
            conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Error removing community member for {username}: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/update_user_password', methods=['POST'])
@login_required
def update_user_password():
    username = session['username']
    if username != 'admin':
        return jsonify({'success': False, 'error': 'Admin access required'})
    
    target_username = request.form.get('username')
    new_password = request.form.get('new_password')
    
    if not target_username or not new_password:
        return jsonify({'success': False, 'error': 'Username and new password required'})
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            # Check if target user exists
            c.execute("SELECT rowid FROM users WHERE username = ?", (target_username,))
            user = c.fetchone()
            if not user:
                return jsonify({'success': False, 'error': 'User not found'})
            
            # Hash the new password
            hashed_password = generate_password_hash(new_password)
            
            # Update the password
            c.execute("UPDATE users SET password = ? WHERE username = ?", (hashed_password, target_username))
            conn.commit()
            
        return jsonify({'success': True, 'message': f'Password updated successfully for {target_username}'})
    except Exception as e:
        logger.error(f"Error updating password for {target_username}: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/debug_password/<username>')
def debug_password(username):
    """Temporary debug route to check password status - REMOVE IN PRODUCTION"""
    # Only allow admin to access this
    if session.get('username') != 'admin':
        return "Unauthorized", 403
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT password FROM users WHERE username=?", (username,))
            user = c.fetchone()
            
            if not user:
                return f"User '{username}' not found"
            
            password = user[0] if user else None
            
            info = {
                'username': username,
                'password_exists': password is not None,
                'password_length': len(password) if password else 0,
                'is_hashed': False,
                'hash_type': 'plain text'
            }
            
            if password:
                if password.startswith('$2b$') or password.startswith('$2a$') or password.startswith('$2y$'):
                    info['is_hashed'] = True
                    info['hash_type'] = 'bcrypt'
                elif password.startswith('scrypt:'):
                    info['is_hashed'] = True
                    info['hash_type'] = 'scrypt'
                elif password.startswith('pbkdf2:'):
                    info['is_hashed'] = True
                    info['hash_type'] = 'pbkdf2'
                    
                # Show first 20 chars for debugging (safe for hashed passwords)
                info['password_preview'] = password[:20] + '...' if len(password) > 20 else password
            
            return f"""
            <h2>Password Debug Info for {username}</h2>
            <pre>{json.dumps(info, indent=2)}</pre>
            <br>
            <h3>Reset Password for {username}:</h3>
            <form action="/reset_password_debug/{username}" method="POST">
                <input type="password" name="new_password" placeholder="New password" required>
                <button type="submit">Reset Password (Plain Text)</button>
            </form>
            <form action="/reset_password_debug_hashed/{username}" method="POST">
                <input type="password" name="new_password" placeholder="New password" required>
                <button type="submit">Reset Password (Hashed)</button>
            </form>
            """
    except Exception as e:
        return f"Error: {str(e)}"

@app.route('/reset_password_debug/<username>', methods=['POST'])
def reset_password_debug(username):
    """Reset password as plain text - TEMPORARY DEBUG"""
    if session.get('username') != 'admin':
        return "Unauthorized", 403
    
    new_password = request.form.get('new_password')
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            # Set as plain text
            c.execute("UPDATE users SET password=? WHERE username=?", (new_password, username))
            conn.commit()
        return f"Password for {username} reset to plain text: '{new_password}'. <a href='/'>Go to login</a>"
    except Exception as e:
        return f"Error: {str(e)}"

@app.route('/reset_password_debug_hashed/<username>', methods=['POST'])
def reset_password_debug_hashed(username):
    """Reset password as hashed - TEMPORARY DEBUG"""
    if session.get('username') != 'admin':
        return "Unauthorized", 403
    
    new_password = request.form.get('new_password')
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            # Hash the password
            hashed = generate_password_hash(new_password)
            c.execute("UPDATE users SET password=? WHERE username=?", (hashed, username))
            conn.commit()
        return f"Password for {username} reset to hashed version of: '{new_password}'. <a href='/'>Go to login</a>"
    except Exception as e:
        return f"Error: {str(e)}"

@app.route('/request_password_reset', methods=['POST'])
def request_password_reset():
    """Handle password reset requests"""
    try:
        data = request.get_json()
        username = data.get('username')
        email = data.get('email')
        
        if not username or not email:
            return jsonify({'success': False, 'message': 'Username and email are required'}), 400
        
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Check if user exists with matching email
            c.execute("SELECT email FROM users WHERE username = ?", (username,))
            result = c.fetchone()
            
            # For security, always return success even if user doesn't exist
            if result and result['email'] == email:
                # Generate secure token
                token = secrets.token_urlsafe(32)
                created_at = datetime.now().isoformat()
                
                # Delete any existing unused tokens for this user
                c.execute("DELETE FROM password_reset_tokens WHERE username = ? AND used = 0", (username,))
                
                # Insert new token
                c.execute("""
                    INSERT INTO password_reset_tokens (username, email, token, created_at)
                    VALUES (?, ?, ?, ?)
                """, (username, email, token, created_at))
                conn.commit()
                
                # In a production environment, you would send an email here
                # For now, we'll log the reset link
                reset_link = f"{request.host_url}reset_password/{token}"
                logger.info(f"Password reset link for {username}: {reset_link}")
                
                # TODO: Implement email sending
                # send_password_reset_email(email, username, reset_link)
        
        # Always return success for security
        return jsonify({'success': True, 'message': 'If an account exists with the provided information, a reset link has been sent.'})
        
    except Exception as e:
        logger.error(f"Error in password reset request: {e}")
        # Still return success for security
        return jsonify({'success': True, 'message': 'If an account exists with the provided information, a reset link has been sent.'})

@app.route('/reset_password/<token>', methods=['GET', 'POST'])
def reset_password(token):
    """Handle password reset with token"""
    if request.method == 'GET':
        # Verify token is valid and not expired (24 hours)
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("""
                SELECT username, created_at, used 
                FROM password_reset_tokens 
                WHERE token = ?
            """, (token,))
            result = c.fetchone()
            
            if not result:
                flash('Invalid or expired reset link.', 'error')
                return redirect(url_for('index'))
            
            if result['used']:
                flash('This reset link has already been used.', 'error')
                return redirect(url_for('index'))
            
            # Check if token is expired (24 hours)
            created_at = datetime.fromisoformat(result['created_at'])
            if datetime.now() - created_at > timedelta(hours=24):
                flash('This reset link has expired.', 'error')
                return redirect(url_for('index'))
            
            return render_template('reset_password.html', token=token, username=result['username'])
    
    elif request.method == 'POST':
        new_password = request.form.get('password')
        confirm_password = request.form.get('confirm_password')
        
        if not new_password or not confirm_password:
            flash('Please fill in all fields.', 'error')
            return redirect(url_for('reset_password', token=token))
        
        if new_password != confirm_password:
            flash('Passwords do not match.', 'error')
            return redirect(url_for('reset_password', token=token))
        
        if len(new_password) < 6:
            flash('Password must be at least 6 characters long.', 'error')
            return redirect(url_for('reset_password', token=token))
        
        try:
            with get_db_connection() as conn:
                c = conn.cursor()
                
                # Verify token again
                c.execute("""
                    SELECT username, created_at, used 
                    FROM password_reset_tokens 
                    WHERE token = ?
                """, (token,))
                result = c.fetchone()
                
                if not result or result['used']:
                    flash('Invalid or expired reset link.', 'error')
                    return redirect(url_for('index'))
                
                # Check expiration again
                created_at = datetime.fromisoformat(result['created_at'])
                if datetime.now() - created_at > timedelta(hours=24):
                    flash('This reset link has expired.', 'error')
                    return redirect(url_for('index'))
                
                # Update password
                hashed_password = generate_password_hash(new_password)
                c.execute("UPDATE users SET password = ? WHERE username = ?", 
                         (hashed_password, result['username']))
                
                # Mark token as used
                c.execute("UPDATE password_reset_tokens SET used = 1 WHERE token = ?", (token,))
                conn.commit()
                
                flash('Your password has been successfully reset. You can now log in with your new password.', 'success')
                return redirect(url_for('index'))
                
        except Exception as e:
            logger.error(f"Error resetting password: {e}")
            flash('An error occurred. Please try again.', 'error')
            return redirect(url_for('reset_password', token=token))

@app.route('/test_password_hash')
def test_password_hash():
    """Test password hashing and verification"""
    if session.get('username') != 'admin':
        return "Unauthorized", 403
    
    test_password = "test123"
    
    # Test different hash methods
    from werkzeug.security import generate_password_hash, check_password_hash
    
    results = []
    
    # Test default hash
    try:
        hash1 = generate_password_hash(test_password)
        verify1 = check_password_hash(hash1, test_password)
        results.append({
            'method': 'default',
            'hash': hash1[:50] + '...',
            'verify_same': verify1,
            'verify_wrong': check_password_hash(hash1, "wrong")
        })
    except Exception as e:
        results.append({'method': 'default', 'error': str(e)})
    
    # Test with specific method
    try:
        hash2 = generate_password_hash(test_password, method='pbkdf2:sha256')
        verify2 = check_password_hash(hash2, test_password)
        results.append({
            'method': 'pbkdf2:sha256',
            'hash': hash2[:50] + '...',
            'verify_same': verify2,
            'verify_wrong': check_password_hash(hash2, "wrong")
        })
    except Exception as e:
        results.append({'method': 'pbkdf2:sha256', 'error': str(e)})
    
    # Test with scrypt
    try:
        hash3 = generate_password_hash(test_password, method='scrypt')
        verify3 = check_password_hash(hash3, test_password)
        results.append({
            'method': 'scrypt',
            'hash': hash3[:50] + '...',
            'verify_same': verify3,
            'verify_wrong': check_password_hash(hash3, "wrong")
        })
    except Exception as e:
        results.append({'method': 'scrypt', 'error': str(e)})
    
    return f"""
    <h2>Password Hash Testing</h2>
    <p>Test password: "{test_password}"</p>
    <pre>{json.dumps(results, indent=2)}</pre>
    <br>
    <h3>Test Specific Password:</h3>
    <form method="POST" action="/test_specific_password">
        <input type="text" name="username" placeholder="Username" required><br>
        <input type="password" name="password" placeholder="Password to test" required><br>
        <button type="submit">Test Login</button>
    </form>
    """
@app.route('/test_specific_password', methods=['POST'])
def test_specific_password():
    """Test a specific username/password combination"""
    if session.get('username') != 'admin':
        return "Unauthorized", 403
    
    test_username = request.form.get('username')
    test_password = request.form.get('password')
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT password FROM users WHERE username=?", (test_username,))
            user = c.fetchone()
            
            if not user:
                return f"User '{test_username}' not found"
            
            stored_password = user[0]
            
            result = {
                'username': test_username,
                'input_password': test_password,
                'stored_password_preview': stored_password[:30] + '...' if len(stored_password) > 30 else stored_password,
                'stored_password_length': len(stored_password),
                'starts_with_dollar': stored_password.startswith('$'),
                'starts_with_scrypt': stored_password.startswith('scrypt:'),
                'starts_with_pbkdf2': stored_password.startswith('pbkdf2:'),
            }
            
            # Test our login logic
            if stored_password and (stored_password.startswith('$') or stored_password.startswith('scrypt:') or stored_password.startswith('pbkdf2:')):
                result['detected_as'] = 'hashed'
                try:
                    from werkzeug.security import check_password_hash
                    password_correct = check_password_hash(stored_password, test_password)
                    result['check_password_hash_result'] = password_correct
                    
                    # Try to manually verify for debugging
                    import hashlib
                    result['debug_info'] = {
                        'werkzeug_version': 'checking...',
                        'hash_method_detected': stored_password.split(':')[0] if ':' in stored_password else 'unknown'
                    }
                except Exception as e:
                    result['check_password_hash_error'] = str(e)
                    password_correct = False
            else:
                result['detected_as'] = 'plain text'
                password_correct = (stored_password == test_password)
                result['plain_text_match'] = password_correct
            
            result['would_login_work'] = password_correct
            
            return f"""
            <h2>Password Test Results for {test_username}</h2>
            <pre>{json.dumps(result, indent=2)}</pre>
            <br>
            <a href="/debug_password/{test_username}">Go to password debug/reset page</a>
            """
            
    except Exception as e:
        return f"Error: {str(e)}"
@app.route('/migrate_passwords')
def migrate_passwords():
    """Migrate all plain text passwords to hashed passwords - ADMIN ONLY"""
    if session.get('username') != 'admin':
        return "Unauthorized", 403
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Get all users
            c.execute("SELECT username, password FROM users")
            users = c.fetchall()
            
            results = {
                'total_users': len(users),
                'already_hashed': 0,
                'migrated': 0,
                'failed': 0,
                'details': []
            }
            
            for user in users:
                username = user[0]
                password = user[1]
                
                if not password:
                    results['failed'] += 1
                    results['details'].append(f"{username}: No password set")
                    continue
                
                # Check if already hashed
                if password.startswith('$') or password.startswith('scrypt:') or password.startswith('pbkdf2:'):
                    results['already_hashed'] += 1
                    results['details'].append(f"{username}: Already hashed")
                else:
                    # It's plain text, hash it
                    try:
                        hashed_password = generate_password_hash(password)
                        c.execute("UPDATE users SET password = ? WHERE username = ?", 
                                (hashed_password, username))
                        results['migrated'] += 1
                        results['details'].append(f"{username}: Migrated successfully")
                    except Exception as e:
                        results['failed'] += 1
                        results['details'].append(f"{username}: Failed - {str(e)}")
            
            # Commit all changes
            conn.commit()
            
            # Format results for display
            return f"""
            <!DOCTYPE html>
            <html>
            <head>
                <title>Password Migration Results</title>
                <style>
                    body {{
                        background: #000;
                        color: #fff;
                        font-family: Arial, sans-serif;
                        padding: 20px;
                        max-width: 800px;
                        margin: 0 auto;
                    }}
                    .success {{ color: #4db6ac; }}
                    .warning {{ color: #ffa726; }}
                    .error {{ color: #ef5350; }}
                    .stats {{
                        background: #1a1a1a;
                        padding: 20px;
                        border-radius: 8px;
                        margin: 20px 0;
                    }}
                    .details {{
                        background: #0a0a0a;
                        padding: 15px;
                        border-radius: 8px;
                        margin: 20px 0;
                        max-height: 400px;
                        overflow-y: auto;
                    }}
                    .detail-item {{
                        padding: 5px 0;
                        border-bottom: 1px solid #333;
                    }}
                    button {{
                        background: #4db6ac;
                        color: white;
                        border: none;
                        padding: 10px 20px;
                        border-radius: 4px;
                        cursor: pointer;
                        margin-top: 20px;
                    }}
                    button:hover {{
                        background: #5bc7bd;
                    }}
                </style>
            </head>
            <body>
                <h1>Password Migration Results</h1>
                <div class="stats">
                    <h2>Summary</h2>
                    <p>Total Users: <strong>{results['total_users']}</strong></p>
                    <p class="success">✓ Successfully Migrated: <strong>{results['migrated']}</strong></p>
                    <p class="warning">⚠ Already Hashed: <strong>{results['already_hashed']}</strong></p>
                    <p class="error">✗ Failed: <strong>{results['failed']}</strong></p>
                </div>
                <div class="details">
                    <h3>Details</h3>
                    {''.join([f'<div class="detail-item">{detail}</div>' for detail in results['details']])}
                </div>
                <button onclick="window.location.href='/admin'">Back to Admin Dashboard</button>
                <button onclick="window.location.href='/test_password_hash'">Test Password Hashing</button>
            </body>
            </html>
            """
            
    except Exception as e:
        logger.error(f"Error during password migration: {str(e)}")
        return f"Migration failed: {str(e)}", 500

@app.route('/check_password_status')
def check_password_status():
    """Check the status of passwords in the database - ADMIN ONLY"""
    if session.get('username') != 'admin':
        return "Unauthorized", 403
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Get all users and their password status
            c.execute("SELECT username, password FROM users")
            users = c.fetchall()
            
            plain_text = []
            hashed = []
            no_password = []
            
            for user in users:
                username = user[0]
                password = user[1]
                
                if not password:
                    no_password.append(username)
                elif password.startswith('$') or password.startswith('scrypt:') or password.startswith('pbkdf2:'):
                    hashed.append(username)
                else:
                    plain_text.append(username)
            
            return f"""
            <!DOCTYPE html>
            <html>
            <head>
                <title>Password Status Check</title>
                <style>
                    body {{
                        background: #000;
                        color: #fff;
                        font-family: Arial, sans-serif;
                        padding: 20px;
                        max-width: 800px;
                        margin: 0 auto;
                    }}
                    .section {{
                        background: #1a1a1a;
                        padding: 20px;
                        border-radius: 8px;
                        margin: 20px 0;
                    }}
                    .plain-text {{ border-left: 4px solid #ef5350; }}
                    .hashed {{ border-left: 4px solid #4db6ac; }}
                    .no-password {{ border-left: 4px solid #ffa726; }}
                    .user-list {{
                        display: flex;
                        flex-wrap: wrap;
                        gap: 10px;
                        margin-top: 10px;
                    }}
                    .user-item {{
                        background: #0a0a0a;
                        padding: 5px 10px;
                        border-radius: 4px;
                    }}
                    .migrate-btn {{
                        background: #ef5350;
                        color: white;
                        border: none;
                        padding: 15px 30px;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 16px;
                        margin: 20px 0;
                    }}
                    .migrate-btn:hover {{
                        background: #f44336;
                    }}
                    button {{
                        background: #4db6ac;
                        color: white;
                        border: none;
                        padding: 10px 20px;
                        border-radius: 4px;
                        cursor: pointer;
                        margin-right: 10px;
                    }}
                    button:hover {{
                        background: #5bc7bd;
                    }}
                </style>
            </head>
            <body>
                <h1>Password Security Status</h1>
                
                <div class="section plain-text">
                    <h2>⚠️ Plain Text Passwords ({len(plain_text)} users)</h2>
                    <p>These passwords are stored in plain text and need to be migrated:</p>
                    <div class="user-list">
                        {''.join([f'<span class="user-item">{u}</span>' for u in plain_text]) if plain_text else '<em>None</em>'}
                    </div>
                </div>
                
                <div class="section hashed">
                    <h2>✅ Hashed Passwords ({len(hashed)} users)</h2>
                    <p>These passwords are properly hashed and secure:</p>
                    <div class="user-list">
                        {''.join([f'<span class="user-item">{u}</span>' for u in hashed]) if hashed else '<em>None</em>'}
                    </div>
                </div>
                
                <div class="section no-password">
                    <h2>❓ No Password Set ({len(no_password)} users)</h2>
                    <p>These users have no password set:</p>
                    <div class="user-list">
                        {''.join([f'<span class="user-item">{u}</span>' for u in no_password]) if no_password else '<em>None</em>'}
                    </div>
                </div>
                
                {f'''
                <button class="migrate-btn" onclick="if(confirm(&quot;This will hash all {len(plain_text)} plain text passwords. Continue?&quot;)) window.location.href=&quot;/migrate_passwords&quot;">
                    🔒 Migrate {len(plain_text)} Plain Text Passwords to Hashed
                </button>
                ''' if plain_text else '<p style="color: #4db6ac; font-size: 18px;">✅ All passwords are already hashed!</p>'}
                
                <div style="margin-top: 30px;">
                    <button onclick="window.location.href='/admin'">Back to Admin Dashboard</button>
                    <button onclick="window.location.reload()">Refresh Status</button>
                </div>
            </body>
            </html>
            """
            
    except Exception as e:
        logger.error(f"Error checking password status: {str(e)}")
        return f"Error: {str(e)}", 500

@app.route('/check_duplicate_users')
def check_duplicate_users():
    """Check for duplicate usernames in the database - ADMIN ONLY"""
    if session.get('username') != 'admin':
        return "Unauthorized", 403
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Check for duplicate usernames
            c.execute("""
                SELECT username, COUNT(*) as count, GROUP_CONCAT(rowid) as ids, 
                       GROUP_CONCAT(password, '|||') as passwords,
                       GROUP_CONCAT(email, '|||') as emails,
                       GROUP_CONCAT(subscription, '|||') as subscriptions
                FROM users 
                GROUP BY LOWER(username) 
                HAVING count > 1
            """)
            duplicates = c.fetchall()
            
            # Get all admin records specifically
            c.execute("""
                SELECT rowid, username, email, password, subscription, created_at
                FROM users 
                WHERE LOWER(username) = 'admin'
                ORDER BY rowid
            """)
            admin_records = c.fetchall()
            
            # Build the duplicates table HTML
            duplicates_html = ""
            if duplicates:
                duplicates_rows = []
                for dup in duplicates:
                    username = str(dup[0])
                    count = str(dup[1])
                    row_ids = str(dup[2])
                    password_preview = str(dup[3])[:50] if dup[3] else ""
                    emails = str(dup[4])
                    subscriptions = str(dup[5])
                    
                    row_html = f'''
                        <tr>
                            <td>{username}</td>
                            <td>{count}</td>
                            <td>{row_ids}</td>
                            <td class="password-cell">{password_preview}...</td>
                            <td>{emails}</td>
                            <td>{subscriptions}</td>
                            <td>
                                <button class="fix-btn" onclick="if(confirm('Keep only the first record and delete duplicates for {username}?')) window.location.href='/fix_duplicate_user/{username}'">
                                    Fix Duplicates
                                </button>
                            </td>
                        </tr>'''
                    duplicates_rows.append(row_html)
                
                duplicates_html = f'''
                <div class="section duplicate">
                    <h2>⚠️ Duplicate Usernames Found ({len(duplicates)} usernames)</h2>
                    <table>
                        <tr>
                            <th>Username</th>
                            <th>Count</th>
                            <th>Row IDs</th>
                            <th>Passwords</th>
                            <th>Emails</th>
                            <th>Subscriptions</th>
                            <th>Action</th>
                        </tr>
                        {"".join(duplicates_rows)}
                    </table>
                </div>'''
            else:
                duplicates_html = '''
                <div class="section" style="border-left: 4px solid #4db6ac;">
                    <h2>✅ No Duplicate Usernames Found</h2>
                    <p>All usernames in the database are unique.</p>
                </div>'''
            
            # Build admin records HTML
            admin_rows = []
            for record in admin_records:
                row_id = str(record[0])
                username = str(record[1])
                email = str(record[2]) if record[2] else 'N/A'
                password_preview = str(record[3])[:30] if record[3] else 'N/A'
                subscription = str(record[4]) if record[4] else 'N/A'
                created_at = str(record[5]) if record[5] else 'N/A'
                
                admin_row = f'''
                        <tr>
                            <td>{row_id}</td>
                            <td>{username}</td>
                            <td>{email}</td>
                            <td class="password-cell">{password_preview}...</td>
                            <td>{subscription}</td>
                            <td>{created_at}</td>
                        </tr>'''
                admin_rows.append(admin_row)
            
            admin_warning = ''
            admin_fix_button = ''
            if len(admin_records) > 1:
                admin_warning = '''
                    <div class="warning">
                        ⚠️ Found multiple records for admin account. There should only be 1.
                    </div>'''
                admin_fix_button = '''
                    <button class="fix-btn" onclick="if(confirm('This will keep the first admin record and delete the rest. Continue?')) window.location.href='/fix_duplicate_user/admin'">
                        Fix Admin Duplicates
                    </button>'''
            
            return f"""
            <!DOCTYPE html>
            <html>
            <head>
                <title>Duplicate Users Check</title>
                <style>
                    body {{
                        background: #000;
                        color: #fff;
                        font-family: Arial, sans-serif;
                        padding: 20px;
                        max-width: 1200px;
                        margin: 0 auto;
                    }}
                    .section {{
                        background: #1a1a1a;
                        padding: 20px;
                        border-radius: 8px;
                        margin: 20px 0;
                    }}
                    .duplicate {{
                        border-left: 4px solid #ef5350;
                    }}
                    .admin-records {{
                        border-left: 4px solid #ffa726;
                    }}
                    table {{
                        width: 100%;
                        border-collapse: collapse;
                        margin-top: 15px;
                    }}
                    th, td {{
                        padding: 10px;
                        text-align: left;
                        border-bottom: 1px solid #333;
                    }}
                    th {{
                        background: #0a0a0a;
                        color: #4db6ac;
                    }}
                    .password-cell {{
                        font-family: monospace;
                        font-size: 12px;
                        word-break: break-all;
                    }}
                    .fix-btn {{
                        background: #ef5350;
                        color: white;
                        border: none;
                        padding: 8px 15px;
                        border-radius: 4px;
                        cursor: pointer;
                        margin: 5px;
                    }}
                    .fix-btn:hover {{
                        background: #f44336;
                    }}
                    button {{
                        background: #4db6ac;
                        color: white;
                        border: none;
                        padding: 10px 20px;
                        border-radius: 4px;
                        cursor: pointer;
                        margin-right: 10px;
                    }}
                    button:hover {{
                        background: #5bc7bd;
                    }}
                    .warning {{
                        background: rgba(255, 152, 0, 0.1);
                        border: 1px solid #ff9800;
                        padding: 15px;
                        border-radius: 4px;
                        margin: 15px 0;
                    }}
                </style>
            </head>
            <body>
                <h1>Duplicate Users Check</h1>
                
                {duplicates_html}
    
                <div class="section admin-records">
                    <h2>Admin Account Records ({len(admin_records)} records)</h2>
                    {admin_warning}
                    <table>
                        <tr>
                            <th>Row ID</th>
                            <th>Username</th>
                            <th>Email</th>
                            <th>Password (first 30 chars)</th>
                            <th>Subscription</th>
                            <th>Created At</th>
                        </tr>
                        {"".join(admin_rows)}
                    </table>
                    {admin_fix_button}
                </div>
                
                <div style="margin-top: 30px;">
                    <button onclick="window.location.href='/admin'">Back to Admin Dashboard</button>
                    <button onclick="window.location.reload()">Refresh</button>
                    <button onclick="window.location.href='/check_password_status'">Check Password Status</button>
                </div>
            </body>
            </html>
            """
            
    except Exception as e:
        logger.error(f"Error checking duplicate users: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return f"Error: {str(e)}", 500

@app.route('/fix_duplicate_user/<username>')
def fix_duplicate_user(username):
    """Fix duplicate user records by keeping only the first one - ADMIN ONLY"""
    if session.get('username') != 'admin':
        return "Unauthorized", 403
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Get all records for this username
            c.execute("""
                SELECT rowid, username, password, email, subscription
                FROM users 
                WHERE LOWER(username) = LOWER(?)
                ORDER BY rowid
            """, (username,))
            records = c.fetchall()
            
            if len(records) <= 1:
                return f"No duplicates found for {username}. <a href='/check_duplicate_users'>Go back</a>"
            
            # Keep the first record, delete the rest
            keep_record = records[0]
            delete_ids = [str(r[0]) for r in records[1:]]
            
            # Delete duplicate records
            c.execute(f"""
                DELETE FROM users 
                WHERE rowid IN ({','.join(['?' for _ in delete_ids])})
            """, delete_ids)
            
            conn.commit()
            
            return f"""
            <!DOCTYPE html>
            <html>
            <head>
                <title>Duplicate Fixed</title>
                <style>
                    body {{
                        background: #000;
                        color: #fff;
                        font-family: Arial, sans-serif;
                        padding: 20px;
                        max-width: 800px;
                        margin: 0 auto;
                    }}
                    .success {{
                        background: rgba(77, 182, 172, 0.1);
                        border: 1px solid #4db6ac;
                        padding: 20px;
                        border-radius: 8px;
                        margin: 20px 0;
                    }}
                    button {{
                        background: #4db6ac;
                        color: white;
                        border: none;
                        padding: 10px 20px;
                        border-radius: 4px;
                        cursor: pointer;
                        margin-right: 10px;
                        margin-top: 20px;
                    }}
                    button:hover {{
                        background: #5bc7bd;
                    }}
                </style>
            </head>
            <body>
                <h1>Duplicate Fixed</h1>
                <div class="success">
                    <h2>✅ Successfully Fixed Duplicates for {username}</h2>
                    <p>Kept record ID: {keep_record[0]}</p>
                    <p>Deleted {len(delete_ids)} duplicate records (IDs: {', '.join(delete_ids)})</p>
                    <p>Email: {keep_record[3] or 'N/A'}</p>
                    <p>Subscription: {keep_record[4] or 'N/A'}</p>
                </div>
                <button onclick="window.location.href='/check_duplicate_users'">Check for More Duplicates</button>
                <button onclick="window.location.href='/admin'">Back to Admin Dashboard</button>
            </body>
            </html>
            """
            
    except Exception as e:
        logger.error(f"Error fixing duplicate user {username}: {str(e)}")
        return f"Error: {str(e)}", 500

@app.route('/check_unread_messages')
@login_required
def check_unread_messages():
    username = session['username']
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT COUNT(*) as count FROM messages WHERE receiver=? AND is_read=0", (username,))
            result = c.fetchone()
            unread_count = result['count'] if hasattr(result, 'keys') else result[0]
        return jsonify({'unread_count': unread_count})
    except Exception as e:
        logger.error(f"Error checking unread messages for {username}: {str(e)}")
        abort(500)
@app.route('/feed')
@login_required
def feed():
    username = session.get('username')
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            # Fetch only main social feed posts (where community_id is NULL), ordered by the most recent
            c.execute("SELECT * FROM posts WHERE community_id IS NULL ORDER BY id DESC")
            posts_raw = c.fetchall()
            posts = [dict(row) for row in posts_raw]

            for post in posts:
                # Fetch replies for each post
                c.execute("SELECT * FROM replies WHERE post_id = ? ORDER BY timestamp DESC", (post['id'],))
                replies_raw = c.fetchall()
                post['replies'] = [dict(row) for row in replies_raw]

                # --- NEW: Fetch reactions for each post ---
                # Get reaction counts (e.g., {'heart': 5, 'thumbs-up': 2})
                c.execute("""
                    SELECT reaction_type, COUNT(*) as count
                    FROM reactions
                    WHERE post_id = ?
                    GROUP BY reaction_type
                """, (post['id'],))
                reactions_raw = c.fetchall()
                post['reactions'] = {r['reaction_type']: r['count'] for r in reactions_raw}

                # Get the current logged-in user's reaction to this post
                c.execute("SELECT reaction_type FROM reactions WHERE post_id = ? AND username = ?", (post['id'], username))
                user_reaction_raw = c.fetchone()
                post['user_reaction'] = user_reaction_raw['reaction_type'] if user_reaction_raw else None

                # Fetch poll data for this post
                c.execute("SELECT * FROM polls WHERE post_id = ? AND is_active = 1", (post['id'],))
                poll_raw = c.fetchone()
                if poll_raw:
                    poll = dict(poll_raw)
                    # Fetch poll options
                    c.execute("SELECT * FROM poll_options WHERE poll_id = ? ORDER BY id", (poll['id'],))
                    options_raw = c.fetchall()
                    poll['options'] = [dict(option) for option in options_raw]
                    
                    # Get user's vote
                    c.execute("SELECT option_id FROM poll_votes WHERE poll_id = ? AND username = ?", (poll['id'], username))
                    user_vote_raw = c.fetchone()
                    poll['user_vote'] = user_vote_raw['option_id'] if user_vote_raw else None
                    
                    # Calculate total votes
                    total_votes = sum(option['votes'] for option in poll['options'])
                    poll['total_votes'] = total_votes
                    
                    post['poll'] = poll
                else:
                    post['poll'] = None

                # Add reaction counts for each reply and user reaction
                for reply in post['replies']:
                    c.execute("""
                        SELECT reaction_type, COUNT(*) as count
                        FROM reply_reactions
                        WHERE reply_id = ?
                        GROUP BY reaction_type
                    """, (reply['id'],))
                    rr = c.fetchall()
                    reply['reactions'] = {r['reaction_type']: r['count'] for r in rr}
                    c.execute("SELECT reaction_type FROM reply_reactions WHERE reply_id = ? AND username = ?", (reply['id'], username))
                    ur = c.fetchone()
                    reply['user_reaction'] = ur['reaction_type'] if ur else None

        return render_template('feed.html', posts=posts, username=username)
    except Exception as e:
        logger.error(f"Error fetching feed: {str(e)}")
        abort(500)
@app.route('/add_reaction', methods=['POST'])
@login_required
def add_reaction():
    username = session['username']
    post_id = request.form.get('post_id')
    reaction_type = request.form.get('reaction')

    if not all([post_id, reaction_type]):
        return jsonify({'success': False, 'error': 'Missing data'}), 400

    try:
        with get_db_connection() as conn:
            c = conn.cursor()

            # Check if the user already reacted to this post
            c.execute("SELECT id, reaction_type FROM reactions WHERE post_id = ? AND username = ?", (post_id, username))
            existing = c.fetchone()

            if existing:
                if existing['reaction_type'] == reaction_type:
                    # User clicked the same reaction again, so remove it (toggle off)
                    c.execute("DELETE FROM reactions WHERE id = ?", (existing['id'],))
                else:
                    # User changed their reaction, so update it
                    c.execute("UPDATE reactions SET reaction_type = ? WHERE id = ?", (reaction_type, existing['id']))
            else:
                # No existing reaction, so insert a new one
                c.execute("INSERT INTO reactions (post_id, username, reaction_type) VALUES (?, ?, ?)",
                          (post_id, username, reaction_type))

            # Create notification for post owner (only if adding/changing reaction, not removing)
            if existing is None or (existing and existing['reaction_type'] != reaction_type):
                # Get post owner and community_id
                c.execute("SELECT username, community_id FROM posts WHERE id = ?", (post_id,))
                post_data = c.fetchone()
                logger.info(f"Reaction notification check - Post owner: {post_data['username'] if post_data else 'None'}, Reactor: {username}")
                if post_data and post_data['username'] != username:
                    # Insert notification directly in this transaction
                    c.execute("""
                        INSERT INTO notifications (user_id, from_user, type, post_id, community_id, message)
                        VALUES (?, ?, ?, ?, ?, ?)
                    """, (post_data['username'], username, 'reaction', post_id, post_data['community_id'], 
                          f"{username} reacted to your post"))
                    logger.info(f"Created notification for {post_data['username']} from {username}")
            
            conn.commit()

            # After changes, fetch the new reaction counts for the post
            c.execute("""
                SELECT reaction_type, COUNT(*) as count
                FROM reactions
                WHERE post_id = ?
                GROUP BY reaction_type
            """, (post_id,))
            counts_raw = c.fetchall()
            new_counts = {r['reaction_type']: r['count'] for r in counts_raw}

            # Also get the user's new reaction state to send back to the UI
            c.execute("SELECT reaction_type FROM reactions WHERE post_id = ? AND username = ?", (post_id, username))
            user_reaction_raw = c.fetchone()
            new_user_reaction = user_reaction_raw['reaction_type'] if user_reaction_raw else None

            return jsonify({
                'success': True,
                'counts': new_counts,
                'user_reaction': new_user_reaction
            })

    except Exception as e:
        logger.error(f"Error adding reaction: {str(e)}")
        return jsonify({'success': False, 'error': 'Server error'}), 500


def create_notification(user_id, from_user, notification_type, post_id=None, community_id=None, message=None):
    """Helper function to create a notification"""
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("""
                INSERT INTO notifications (user_id, from_user, type, post_id, community_id, message)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (user_id, from_user, notification_type, post_id, community_id, message))
            conn.commit()
    except Exception as e:
        logger.error(f"Error creating notification: {str(e)}")


@app.route('/notifications')
@login_required
def notifications_page():
    """Display notifications page: Mobile -> React SPA, Desktop -> HTML template"""
    username = session.get('username')
    logger.info(f"Notifications page accessed by {username}")
    try:
        ua = request.headers.get('User-Agent', '')
        is_mobile = any(k in ua for k in ['Mobi', 'Android', 'iPhone', 'iPad'])
        if is_mobile:
            base_dir = os.path.dirname(os.path.abspath(__file__))
            dist_dir = os.path.join(base_dir, 'client', 'dist')
            return send_from_directory(dist_dir, 'index.html')
    except Exception as e:
        logger.warning(f"React notifications fallback: {e}")
    return render_template('notifications.html', username=username)





@app.route('/get_logo')
def get_logo():
    """Get the current logo path"""
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT value FROM site_settings WHERE key = 'logo_path'")
            result = c.fetchone()
            
            if result:
                return jsonify({'success': True, 'logo_path': result['value']})
            else:
                return jsonify({'success': True, 'logo_path': None})
    except:
        return jsonify({'success': True, 'logo_path': None})


@app.route('/remove_logo', methods=['POST'])
@login_required
def remove_logo():
    """Remove the logo - admin only"""
    if session['username'] != 'admin':
        return jsonify({'success': False, 'error': 'Unauthorized'}), 403
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Get current logo path to delete file
            c.execute("SELECT value FROM site_settings WHERE key = 'logo_path'")
            result = c.fetchone()
            
            if result and result['value']:
                # Delete the file
                logo_path = os.path.join('static', result['value'])
                if os.path.exists(logo_path):
                    os.remove(logo_path)
            
            # Remove from database
            c.execute("DELETE FROM site_settings WHERE key = 'logo_path'")
            conn.commit()
        
        return jsonify({'success': True, 'message': 'Logo removed successfully'})
        
    except Exception as e:
        logger.error(f"Error removing logo: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/notifications/check')
@login_required
def check_new_notifications():
    """Check for new notifications since last check timestamp"""
    username = session['username']
    last_check = request.args.get('since', '')
    
    try:
        # If no timestamp provided, get notifications from last 5 seconds
        if not last_check:
            last_check = (datetime.now() - timedelta(seconds=5)).strftime('%Y-%m-%d %H:%M:%S')
        
        with get_db_connection() as conn:
            c = conn.cursor()
            # Get new unread notifications created after last check
            c.execute("""
                SELECT id, from_user, type, post_id, community_id, message, is_read, created_at
                FROM notifications
                WHERE user_id = ? AND is_read = 0 AND created_at > ?
                ORDER BY created_at DESC
                LIMIT 10
            """, (username, last_check))
            
            notifications = []
            for row in c.fetchall():
                notifications.append({
                    'id': row['id'],
                    'from_user': row['from_user'],
                    'type': row['type'],
                    'post_id': row['post_id'],
                    'community_id': row['community_id'],
                    'message': row['message'],
                    'is_read': row['is_read'],
                    'created_at': row['created_at']
                })
            
            return jsonify({
                'success': True,
                'notifications': notifications,
                'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            })
    except Exception as e:
        logger.error(f"Error checking notifications: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/notifications')
@login_required
def get_notifications():
    """Get notifications for the current user"""
    username = session['username']
    
    # Get 'all' parameter to determine if we should show all or just unread
    show_all = request.args.get('all', 'false').lower() == 'true'
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Auto-cleanup: Delete read notifications older than 7 days
            c.execute("""
                DELETE FROM notifications
                WHERE user_id = ? 
                AND is_read = 1 
                AND created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)
            """, (username,))
            conn.commit()
            
            # Build query based on whether to show all or just unread
            if show_all:
                # For notifications page, show all notifications
                c.execute("""
                    SELECT id, from_user, type, post_id, community_id, message, is_read, created_at
                    FROM notifications
                    WHERE user_id = ?
                    ORDER BY created_at DESC
                    LIMIT 50
                """, (username,))
            else:
                # For real-time checking, only show unread
                c.execute("""
                    SELECT id, from_user, type, post_id, community_id, message, is_read, created_at
                    FROM notifications
                    WHERE user_id = ? AND is_read = 0
                    ORDER BY created_at DESC
                    LIMIT 50
                """, (username,))
            
            notifications = []
            for row in c.fetchall():
                notifications.append({
                    'id': row['id'],
                    'from_user': row['from_user'],
                    'type': row['type'],
                    'post_id': row['post_id'],
                    'community_id': row['community_id'],
                    'message': row['message'],
                    'is_read': bool(row['is_read']),
                    'created_at': row['created_at']
                })
            
            logger.info(f"User {username} has {len(notifications)} notifications, {sum(1 for n in notifications if not n['is_read'])} unread")
            return jsonify({'success': True, 'notifications': notifications})
            
    except Exception as e:
        logger.error(f"Error getting notifications: {str(e)}")
        return jsonify({'success': False, 'error': 'Server error'}), 500


@app.route('/api/notifications/<int:notification_id>/read', methods=['POST'])
@login_required
def mark_notification_read(notification_id):
    """Mark a notification as read"""
    username = session['username']
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("""
                UPDATE notifications 
                SET is_read = 1 
                WHERE id = ? AND user_id = ?
            """, (notification_id, username))
            conn.commit()
            
            return jsonify({'success': True})
            
    except Exception as e:
        logger.error(f"Error marking notification as read: {str(e)}")
        return jsonify({'success': False, 'error': 'Server error'}), 500


@app.route('/api/notifications/mark-all-read', methods=['POST'])
@login_required
def mark_all_notifications_read():
    """Mark all notifications as read for the current user"""
    username = session['username']
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("""
                UPDATE notifications 
                SET is_read = 1 
                WHERE user_id = ? AND is_read = 0
            """, (username,))
            conn.commit()
            
            return jsonify({'success': True})
            
    except Exception as e:
        logger.error(f"Error marking all notifications as read: {str(e)}")
        return jsonify({'success': False, 'error': 'Server error'}), 500


@app.route('/api/notifications/delete-read', methods=['POST'])
@login_required
def delete_read_notifications():
    """Delete all read notifications for the current user"""
    username = session['username']
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("""
                DELETE FROM notifications
                WHERE user_id = ? AND is_read = 1
            """, (username,))
            conn.commit()
            
            deleted_count = c.rowcount
            return jsonify({'success': True, 'deleted': deleted_count})
    except Exception as e:
        logger.error(f"Error deleting read notifications: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/post_status', methods=['POST'])
@login_required
def post_status():
    username = session['username']
    content = request.form.get('content', '').strip()
    community_id_raw = request.form.get('community_id')
    community_id = int(community_id_raw) if community_id_raw else None
    
    # If community_id is not in form, try to get it from referer URL
    if not community_id:
        referer = request.headers.get('Referer', '')
        logger.info(f"Referer URL: {referer}")
        if '/community_feed/' in referer:
            try:
                # Extract community_id from URL like /community_feed/4
                community_id = int(referer.split('/community_feed/')[1].split('/')[0])
                logger.info(f"Extracted community_id from referer: {community_id}")
            except (IndexError, ValueError) as e:
                logger.warning(f"Could not extract community_id from referer: {e}")
    
    logger.info(f"Received post request for {username} with content: {content} in community: {community_id} (raw: {community_id_raw})")
    
    # Debug: Log all form data
    logger.info(f"All form data: {dict(request.form)}")
    
    # Handle file upload
    image_path = None
    if 'image' in request.files:
        file = request.files['image']
        if file.filename != '':
            image_path = save_uploaded_file(file)
            if not image_path:
                if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                    return jsonify({'success': False, 'error': 'Invalid file type. Allowed: png, jpg, jpeg, gif, webp'}), 400
                else:
                    if community_id:
                        return redirect(url_for('community_feed', community_id=community_id) + '?error=Invalid file type. Allowed: png, jpg, jpeg, gif, webp')
                    else:
                        return redirect(url_for('feed') + '?error=Invalid file type. Allowed: png, jpg, jpeg, gif, webp')
    
    if not content and not image_path:
        if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
            return jsonify({'success': False, 'error': 'Content or image is required!'}), 400
        else:
            if community_id:
                return redirect(url_for('community_feed', community_id=community_id) + '?error=Content or image is required!')
            else:
                return redirect(url_for('feed') + '?error=Content or image is required!')
    
    timestamp = datetime.now().strftime('%m.%d.%y %H:%M')
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # If community_id is provided, verify user is member (admin bypass)
            if community_id and username != 'admin':
                c.execute("""
                    SELECT 1 FROM user_communities uc
                    JOIN users u ON uc.user_id = u.id
                    WHERE u.username = ? AND uc.community_id = ?
                """, (username, community_id))
                
                if not c.fetchone():
                    if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
                        return jsonify({'success': False, 'error': 'You are not a member of this community'}), 403
                    else:
                        return redirect(url_for('community_feed', community_id=community_id) + '?error=You are not a member of this community')
            
            # Debug: Log the exact values being inserted
            logger.info(f"About to insert post with values: username={username}, content={content}, image_path={image_path}, timestamp={timestamp}, community_id={community_id} (type: {type(community_id)})")
            
            c.execute("INSERT INTO posts (username, content, image_path, timestamp, community_id) VALUES (?, ?, ?, ?, ?)",
                      (username, content, image_path, timestamp, community_id))
            conn.commit()
            post_id = c.lastrowid
            logger.info(f"Post added successfully for {username} with ID: {post_id} in community: {community_id}")
            
            # Verify the post was saved with correct community_id
            c.execute("SELECT community_id FROM posts WHERE id = ?", (post_id,))
            saved_post = c.fetchone()
            logger.info(f"Verified post {post_id} has community_id: {saved_post['community_id'] if saved_post else 'None'}")
            
            # Also check what posts exist for this community
            c.execute("SELECT id, username, content, community_id FROM posts WHERE community_id = ? ORDER BY id DESC", (community_id,))
            community_posts = c.fetchall()
            logger.info(f"Total posts in community {community_id}: {len(community_posts)}")
            for post in community_posts:
                logger.info(f"  Post {post['id']}: {post['username']} - {post['content'][:50]}... (community_id: {post['community_id']})")

            # Notify community members (excluding creator)
            try:
                c.execute("""
                    SELECT DISTINCT u.username
                    FROM users u
                    JOIN user_communities uc ON u.id = uc.user_id
                    WHERE uc.community_id = ? AND u.username != ?
                """, (community_id, username))
                members = [row['username'] if hasattr(row, 'keys') else row[0] for row in c.fetchall()]
                for member in members:
                    send_push_to_user(member, {
                        'title': 'New community post',
                        'body': f"{username}: {content[:100]}",
                        'url': f"/community_feed_react/{community_id}",
                    })
            except Exception as _e:
                logger.warning(f"push notify community warn: {_e}")
        
        # Check if this is an AJAX request
        if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
            return jsonify({
                'success': True,
                'message': 'Post added!',
                'post': {
                    'id': c.lastrowid, 
                    'username': username, 
                    'content': content, 
                    'image_path': image_path,
                    'timestamp': timestamp,
                    'community_id': community_id
                }
            }), 200
        else:
            # Regular form submission - redirect back to the appropriate page
            if community_id:
                return redirect(url_for('community_feed', community_id=community_id))
            else:
                return redirect(url_for('feed'))
    except Exception as e:
        logger.error(f"Error posting status for {username}: {str(e)}", exc_info=True)
        if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
            return jsonify({'success': False, 'error': f'Unexpected error: {str(e)}'}), 500
        else:
            # For regular form submissions, redirect with error
            if community_id:
                return redirect(url_for('community_feed', community_id=community_id) + '?error=' + str(e))
            else:
                return redirect(url_for('feed') + '?error=' + str(e))

@app.route('/post_reply', methods=['POST'])
@login_required
def post_reply():
    username = session['username']
    
    # Debug CSRF token
    logger.info(f"CSRF validation for user {username}")
    logger.info(f"Request form data: {dict(request.form)}")
    logger.info(f"Request headers: {dict(request.headers)}")
    
    post_id = request.form.get('post_id', type=int)
    content = request.form.get('content', '').strip()
    logger.debug(f"Received reply request for {username} to post {post_id} with content: {content}")

    if not post_id:
        return jsonify({'success': False, 'error': 'Post ID is required!'}), 400

    # Handle file upload for reply
    image_path = None
    if 'image' in request.files:
        file = request.files['image']
        if file.filename != '':
            image_path = save_uploaded_file(file)
            if not image_path:
                return jsonify({'success': False, 'error': 'Invalid file type. Allowed: png, jpg, jpeg, gif, webp'}), 400

    if not content and not image_path:
        return jsonify({'success': False, 'error': 'Content or image is required!'}), 400

    # Use a consistent timestamp format for storage and a display-friendly one for the response
    now = datetime.now()
    timestamp_db = now.strftime('%m.%d.%y %H:%M')
    timestamp_display = now.strftime('%m/%d/%y %I:%M %p')

    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT id FROM posts WHERE id= ?", (post_id,))
            if not c.fetchone():
                return jsonify({'success': False, 'error': 'Post not found!'}), 404

            # Get the community_id from the post
            c.execute("SELECT community_id FROM posts WHERE id = ?", (post_id,))
            post_data = c.fetchone()
            community_id = post_data['community_id'] if post_data else None
            
            parent_reply_id = request.form.get('parent_reply_id', type=int)
            c.execute("INSERT INTO replies (post_id, username, content, image_path, timestamp, community_id, parent_reply_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
                      (post_id, username, content, image_path, timestamp_db, community_id, parent_reply_id))
            reply_id = c.lastrowid
            
            # Get post owner to send notification
            c.execute("SELECT username FROM posts WHERE id = ?", (post_id,))
            post_owner = c.fetchone()
            if post_owner and post_owner['username'] != username:
                # Insert notification directly in this transaction
                c.execute("""
                    INSERT INTO notifications (user_id, from_user, type, post_id, community_id, message)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (post_owner['username'], username, 'reply', post_id, community_id,
                      f"{username} replied to your post"))
            
            conn.commit()

        logger.info(f"Reply added successfully for {username} to post {post_id} with ID: {reply_id}")

        return jsonify({
            'success': True,
            'message': 'Reply added!',
            'reply': {
                'id': reply_id,
                'post_id': post_id,
                'username': username,
                'content': content,
                'image_path': image_path,
                'timestamp': timestamp_display,  # Use the display-friendly timestamp
                'reactions': {},
                'user_reaction': None,
                'parent_reply_id': parent_reply_id
            }
        }), 200
    except Exception as e:
        logger.error(f"Error posting reply for {username}: {str(e)}", exc_info=True)
        return jsonify({'success': False, 'error': f'Unexpected error: {str(e)}'}), 500
@app.route('/create_poll', methods=['POST'])
@login_required
def create_poll():
    """Create a new poll"""
    username = session['username']
    content = request.form.get('content', '').strip()
    question = request.form.get('question', '').strip()
    options = request.form.getlist('options[]')
    community_id_raw = request.form.get('community_id')
    community_id = int(community_id_raw) if community_id_raw else None
    
    # Validate input
    if not question or not options or len(options) < 2:
        return jsonify({'success': False, 'error': 'Question and at least 2 options are required!'})
    
    # Remove empty options
    options = [opt.strip() for opt in options if opt.strip()]
    if len(options) < 2:
        return jsonify({'success': False, 'error': 'At least 2 non-empty options are required!'})
    
    # Limit to 6 options
    if len(options) > 6:
        return jsonify({'success': False, 'error': 'Maximum 6 options allowed!'})
    
    timestamp = datetime.now().strftime('%m.%d.%y %H:%M')
    expires_at_raw = request.form.get('expires_at', '').strip()
    expires_at_sql = None
    if expires_at_raw:
        try:
            # Accept both 'YYYY-MM-DDTHH:MM' and 'YYYY-MM-DD'
            if 'T' in expires_at_raw:
                dt = datetime.strptime(expires_at_raw, '%Y-%m-%dT%H:%M')
            else:
                dt = datetime.strptime(expires_at_raw, '%Y-%m-%d')
            expires_at_sql = dt.strftime('%Y-%m-%d %H:%M:%S')
        except Exception:
            expires_at_sql = None
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # If community_id is provided, verify user is member (admin bypass)
            if community_id and username != 'admin':
                c.execute("""
                    SELECT 1 FROM user_communities uc
                    JOIN users u ON uc.user_id = u.id
                    WHERE u.username = ? AND uc.community_id = ?
                """, (username, community_id))
                
                if not c.fetchone():
                    return jsonify({'success': False, 'error': 'You are not a member of this community'}), 403
            
            # Create the post first
            c.execute("INSERT INTO posts (username, content, image_path, timestamp, community_id) VALUES (?, ?, ?, ?, ?)",
                      (username, content, None, timestamp, community_id))
            post_id = c.lastrowid
            
            # Get single vote setting
            single_vote_raw = request.form.get('single_vote', 'true')
            logger.info(f"Creating poll - single_vote raw value: {single_vote_raw}")
            single_vote = single_vote_raw.lower() == 'true'
            logger.info(f"Creating poll - single_vote processed: {single_vote}")
            
            # Log all form data for debugging
            logger.info(f"Creating poll - all form data: {dict(request.form)}")
            
            # Create the poll
            # Insert with optional expiry if column exists
            try:
                c.execute("INSERT INTO polls (post_id, question, created_by, created_at, single_vote, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
                          (post_id, question, username, timestamp, single_vote, expires_at_sql))
            except Exception:
                c.execute("INSERT INTO polls (post_id, question, created_by, created_at, single_vote) VALUES (?, ?, ?, ?, ?)",
                          (post_id, question, username, timestamp, single_vote))
            poll_id = c.lastrowid
            
            # Create poll options
            for option_text in options:
                c.execute("INSERT INTO poll_options (poll_id, option_text) VALUES (?, ?)",
                          (poll_id, option_text))
            
            conn.commit()
            return jsonify({'success': True, 'message': 'Poll created successfully!', 'post_id': post_id})
            
    except Exception as e:
        logger.error(f"Error creating poll: {str(e)}")
        return jsonify({'success': False, 'error': 'Error creating poll'})

@app.route('/close_poll', methods=['POST'])
@login_required
def close_poll():
    """Close a poll and move it to historical"""
    username = session['username']
    
    if request.is_json:
        data = request.get_json()
        poll_id = data.get('poll_id')
    else:
        poll_id = request.form.get('poll_id', type=int)
    
    if not poll_id:
        return jsonify({'success': False, 'error': 'Invalid poll ID'})
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Check if poll exists and user has permission to close it
            c.execute("SELECT created_by, post_id FROM polls WHERE id = ? AND is_active = 1", (poll_id,))
            poll_data = c.fetchone()
            
            if not poll_data:
                return jsonify({'success': False, 'error': 'Poll not found or already closed'})
            
            # Only poll creator, community admin/owner, or global admin can close
            allowed = False
            if poll_data['created_by'] == username or username == 'admin':
                allowed = True
            else:
                # Determine community of the poll via post
                c.execute("SELECT community_id FROM posts WHERE id = ?", (poll_data['post_id'],))
                pr = c.fetchone()
                community_id = pr['community_id'] if pr else None
                if community_id:
                    # Check if user is community admin or owner
                    # Owner = communities.creator_username
                    c.execute("SELECT creator_username FROM communities WHERE id = ?", (community_id,))
                    cr = c.fetchone()
                    if cr and cr['creator_username'] == username:
                        allowed = True
                    else:
                        # Community admin check (if you have a roles table, replace this logic)
                        c.execute("""
                            SELECT 1 FROM community_admins
                            WHERE community_id = ? AND username = ?
                        """, (community_id, username))
                        if c.fetchone():
                            allowed = True
            if not allowed:
                return jsonify({'success': False, 'error': 'You do not have permission to close this poll'})
            
            # Close the poll
            c.execute("UPDATE polls SET is_active = 0 WHERE id = ?", (poll_id,))
            conn.commit()
            
            return jsonify({'success': True, 'message': 'Poll closed successfully'})
            
    except Exception as e:
        logger.error(f"Error closing poll: {str(e)}")
        return jsonify({'success': False, 'error': 'Error closing poll'})

@app.route('/vote_poll', methods=['POST'])
@login_required
def vote_poll():
    """Vote on a poll"""
    username = session['username']
    
    # Handle both JSON and form data
    if request.is_json:
        data = request.get_json()
        poll_id = data.get('poll_id')
        option_id = data.get('option_id')
        toggle_vote = data.get('toggle_vote', False)  # New parameter for vote toggling
    else:
        poll_id = request.form.get('poll_id', type=int)
        option_id = request.form.get('option_id', type=int)
        toggle_vote = request.form.get('toggle_vote', False)
    
    # Convert toggle_vote to boolean if it's a string
    if isinstance(toggle_vote, str):
        toggle_vote = toggle_vote.lower() == 'true'
    
    logger.info(f"Vote request: poll_id={poll_id}, option_id={option_id}, toggle_vote={toggle_vote}")
    
    if not poll_id or not option_id:
        return jsonify({'success': False, 'error': 'Invalid poll or option ID'})
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Check if poll exists and is active
            c.execute("SELECT p.*, po.id as option_id FROM polls p JOIN poll_options po ON p.id = po.poll_id WHERE p.id = ? AND po.id = ? AND p.is_active = 1", (poll_id, option_id))
            poll_data = c.fetchone()
            
            # Convert to dict to make it mutable
            if poll_data:
                poll_data = dict(poll_data)
                # Handle case where single_vote column might not exist
                if 'single_vote' not in poll_data:
                    poll_data['single_vote'] = True  # Default to single vote
            
            if not poll_data:
                return jsonify({'success': False, 'error': 'Poll not found or inactive'})
            
            # Check if user already voted on this specific option
            c.execute("SELECT id FROM poll_votes WHERE poll_id = ? AND username = ? AND option_id = ?", (poll_id, username, option_id))
            existing_vote_on_option = c.fetchone()
            
            # Check if user already voted on this poll
            c.execute("SELECT id, option_id FROM poll_votes WHERE poll_id = ? AND username = ?", (poll_id, username))
            existing_vote = c.fetchone()
            
            if toggle_vote and existing_vote_on_option:
                # Remove vote from this option
                logger.info(f"Removing vote: poll_id={poll_id}, username={username}, option_id={option_id}")
                c.execute("DELETE FROM poll_votes WHERE poll_id = ? AND username = ? AND option_id = ?", (poll_id, username, option_id))
                message = "Vote removed!"
            elif existing_vote and poll_data['single_vote']:
                # Update existing vote (single vote mode)
                c.execute("UPDATE poll_votes SET option_id = ?, voted_at = ? WHERE poll_id = ? AND username = ?",
                          (option_id, datetime.now().strftime('%m.%d.%y %H:%M'), poll_id, username))
                message = "Vote updated!"
            elif not existing_vote:
                # Create new vote
                c.execute("INSERT INTO poll_votes (poll_id, option_id, username, voted_at) VALUES (?, ?, ?, ?)",
                          (poll_id, option_id, username, datetime.now().strftime('%m.%d.%y %H:%M')))
                message = "Vote recorded successfully!"
            else:
                # Multiple vote mode - add another vote
                c.execute("INSERT INTO poll_votes (poll_id, option_id, username, voted_at) VALUES (?, ?, ?, ?)",
                          (poll_id, option_id, username, datetime.now().strftime('%m.%d.%y %H:%M')))
                message = "Vote added!"
            
            # Update vote count for the selected option
            c.execute("UPDATE poll_options SET votes = (SELECT COUNT(*) FROM poll_votes WHERE option_id = ?) WHERE id = ?", (option_id, option_id))
            
            # Update vote count for the previously selected option (if any and in single vote mode)
            if existing_vote and poll_data['single_vote'] and existing_vote['option_id'] != option_id:
                c.execute("UPDATE poll_options SET votes = (SELECT COUNT(*) FROM poll_votes WHERE option_id = ?) WHERE id = ?", (existing_vote['option_id'], existing_vote['option_id']))
            
            conn.commit()
            
            # Get updated poll results with user vote info
            c.execute("""
                SELECT po.id, po.option_text, po.votes, 
                       (SELECT COUNT(*) FROM poll_votes WHERE poll_id = ?) as total_votes,
                       (SELECT option_id FROM poll_votes WHERE poll_id = ? AND username = ?) as user_vote,
                       (SELECT COUNT(*) FROM poll_votes WHERE poll_id = ? AND username = ? AND option_id = po.id) as user_voted
                FROM poll_options po 
                WHERE po.poll_id = ?
                ORDER BY po.id
            """, (poll_id, poll_id, username, poll_id, username, poll_id))
            poll_results = c.fetchall()
            
            return jsonify({
                'success': True, 
                'message': message,
                'poll_results': [dict(row) for row in poll_results]
            })
            
    except Exception as e:
        logger.error(f"Error voting on poll: {str(e)}")
        return jsonify({'success': False, 'error': 'Error recording vote'})

@app.route('/get_poll_results/<int:poll_id>')
@login_required
def get_poll_results(poll_id):
    """Get poll results"""
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            c.execute("""
                SELECT po.id, po.option_text, po.votes, 
                       (SELECT COUNT(*) FROM poll_votes WHERE poll_id = ?) as total_votes,
                       (SELECT option_id FROM poll_votes WHERE poll_id = ? AND username = ?) as user_vote,
                       (SELECT COUNT(*) FROM poll_votes WHERE poll_id = ? AND username = ? AND option_id = po.id) as user_voted
                FROM poll_options po 
                WHERE po.poll_id = ?
                ORDER BY po.id
            """, (poll_id, poll_id, session['username'], poll_id, session['username'], poll_id))
            
            poll_results = c.fetchall()
            
            if not poll_results:
                return jsonify({'success': False, 'error': 'Poll not found'})
            
            return jsonify({
                'success': True,
                'poll_results': [dict(row) for row in poll_results]
            })
            
    except Exception as e:
        logger.error(f"Error getting poll results: {str(e)}")
        return jsonify({'success': False, 'error': 'Error retrieving poll results'})
@app.route('/get_active_polls')
@login_required
def get_active_polls():
    """Get all active polls for a specific community"""
    try:
        username = session['username']
        community_id = request.args.get('community_id', type=int)
        
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Get active polls (not expired) for the specific community
            if community_id:
                c.execute("""
                    SELECT p.*, po.timestamp as created_at, po.username
                    FROM polls p 
                    JOIN posts po ON p.post_id = po.id 
                    WHERE p.is_active = 1 AND (p.expires_at IS NULL OR p.expires_at >= NOW()) AND po.community_id = ?
                    ORDER BY po.timestamp DESC
                """, (community_id,))
            else:
                # Fallback to all polls if no community_id provided
                c.execute("""
                    SELECT p.*, po.timestamp as created_at, po.username
                    FROM polls p 
                    JOIN posts po ON p.post_id = po.id 
                    WHERE p.is_active = 1 AND (p.expires_at IS NULL OR p.expires_at >= NOW())
                    ORDER BY po.timestamp DESC
                """)
            polls_raw = c.fetchall()
            
            polls = []
            for poll_raw in polls_raw:
                poll = dict(poll_raw)
                
                # Get poll options
                c.execute("SELECT * FROM poll_options WHERE poll_id = ? ORDER BY id", (poll['id'],))
                options_raw = c.fetchall()
                poll['options'] = [dict(option) for option in options_raw]
                
                # Get user's vote
                c.execute("SELECT option_id FROM poll_votes WHERE poll_id = ? AND username = ?", (poll['id'], username))
                user_vote_raw = c.fetchone()
                poll['user_vote'] = user_vote_raw['option_id'] if user_vote_raw else None
                
                # Calculate total votes
                total_votes = sum(option['votes'] for option in poll['options'])
                poll['total_votes'] = total_votes
                
                polls.append(poll)
            
            return jsonify({'success': True, 'polls': polls})
            
    except Exception as e:
        logger.error(f"Error getting active polls: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/delete_poll', methods=['POST'])
@login_required
def delete_poll():
    """Delete a poll permanently (admin or poll creator or community owner)"""
    username = session['username']
    data = request.get_json(silent=True) or {}
    poll_id = data.get('poll_id') or request.form.get('poll_id', type=int)
    if not poll_id:
        return jsonify({'success': False, 'error': 'Invalid poll ID'})
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            # Fetch poll and related post/community
            c.execute("SELECT p.created_by, p.post_id FROM polls p WHERE p.id=?", (poll_id,))
            pr = c.fetchone()
            if not pr:
                return jsonify({'success': False, 'error': 'Poll not found'})
            created_by = pr['created_by']
            c.execute("SELECT community_id FROM posts WHERE id=?", (pr['post_id'],))
            sr = c.fetchone()
            community_id = sr['community_id'] if sr else None
            # Permission: admin, poll creator, or community owner
            allowed = username == 'admin' or username == created_by
            if community_id and not allowed:
                c.execute("SELECT creator_username FROM communities WHERE id=?", (community_id,))
                cr = c.fetchone()
                if cr and cr['creator_username'] == username:
                    allowed = True
            if not allowed:
                return jsonify({'success': False, 'error': 'Not authorized'})
            # Delete poll (cascade removes options and votes)
            c.execute("DELETE FROM polls WHERE id=?", (poll_id,))
            conn.commit()
            return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Error deleting poll: {e}")
        return jsonify({'success': False, 'error': 'Error deleting poll'})
@app.route('/remove_poll_option', methods=['POST'])
@login_required
def remove_poll_option():
    """Remove a poll option (only poll creator can do this)"""
    username = session['username']
    
    if request.is_json:
        data = request.get_json()
        option_id = data.get('option_id')
    else:
        option_id = request.form.get('option_id', type=int)
    
    if not option_id:
        return jsonify({'success': False, 'error': 'Invalid option ID'})
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Check if user is the poll creator
            c.execute("""
                SELECT p.created_by, po.poll_id 
                FROM poll_options po 
                JOIN polls p ON po.poll_id = p.id 
                WHERE po.id = ?
            """, (option_id,))
            poll_data = c.fetchone()
            
            if not poll_data:
                return jsonify({'success': False, 'error': 'Option not found'})
            
            if poll_data['created_by'] != username and username != 'admin':
                return jsonify({'success': False, 'error': 'Only poll creator can remove options'})
            
            # Check if this is the last option
            c.execute("SELECT COUNT(*) as count FROM poll_options WHERE poll_id = ?", (poll_data['poll_id'],))
            option_count = c.fetchone()['count']
            
            if option_count <= 2:
                return jsonify({'success': False, 'error': 'Cannot remove option - minimum 2 options required'})
            
            # Remove the option and all its votes
            c.execute("DELETE FROM poll_votes WHERE option_id = ?", (option_id,))
            c.execute("DELETE FROM poll_options WHERE id = ?", (option_id,))
            
            conn.commit()
            
            return jsonify({'success': True, 'message': 'Option removed successfully'})
            
    except Exception as e:
        logger.error(f"Error removing poll option: {str(e)}")
        return jsonify({'success': False, 'error': 'Error removing option'})

@app.route('/get_historical_polls')
@login_required
def get_historical_polls():
    """Get historical (expired) polls for a specific community"""
    try:
        username = session['username']
        community_id = request.args.get('community_id', type=int)
        
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Get historical polls (expired or inactive) for the specific community
            if community_id:
                c.execute("""
                    SELECT p.*, po.timestamp as created_at, po.username
                    FROM polls p 
                    JOIN posts po ON p.post_id = po.id 
                    WHERE (p.is_active = 0 OR (p.expires_at IS NOT NULL AND p.expires_at < NOW()))
                    AND po.community_id = ?
                    ORDER BY po.timestamp DESC
                """, (community_id,))
            else:
                # Fallback to all polls if no community_id provided
                c.execute("""
                    SELECT p.*, po.timestamp as created_at, po.username
                    FROM polls p 
                    JOIN posts po ON p.post_id = po.id 
                    WHERE p.is_active = 0 OR (p.expires_at IS NOT NULL AND p.expires_at < NOW())
                    ORDER BY po.timestamp DESC
                """)
            polls_raw = c.fetchall()
            
            polls = []
            for poll_raw in polls_raw:
                poll = dict(poll_raw)
                
                # Get poll options
                c.execute("SELECT * FROM poll_options WHERE poll_id = ? ORDER BY id", (poll['id'],))
                options_raw = c.fetchall()
                poll['options'] = [dict(option) for option in options_raw]
                
                # Get user's vote
                c.execute("SELECT option_id FROM poll_votes WHERE poll_id = ? AND username = ?", (poll['id'], username))
                user_vote_raw = c.fetchone()
                poll['user_vote'] = user_vote_raw['option_id'] if user_vote_raw else None
                
                # Calculate total votes
                total_votes = sum(option['votes'] for option in poll['options'])
                poll['total_votes'] = total_votes
                
                polls.append(poll)
            
            return jsonify({'success': True, 'polls': polls})
            
    except Exception as e:
        logger.error(f"Error getting historical polls: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/report_issue', methods=['POST'])
@login_required
def report_issue():
    """Report a new issue for a community"""
    try:
        username = session['username']
        data = request.get_json()
        
        community_id = data.get('community_id')
        title = data.get('title')
        location = data.get('location')
        priority = data.get('priority', 'medium')
        description = data.get('description')
        
        if not all([community_id, title, location, description]):
            return jsonify({'success': False, 'error': 'Missing required fields'})
        
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Insert the new issue
            c.execute("""
                INSERT INTO community_issues 
                (community_id, title, location, priority, description, reported_by, reported_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (community_id, title, location, priority, description, username, 
                  datetime.now().strftime('%Y-%m-%d %H:%M:%S')))
            
            conn.commit()
            
            return jsonify({'success': True, 'message': 'Issue reported successfully'})
            
    except Exception as e:
        logger.error(f"Error reporting issue: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/get_community_issues')
@login_required
def get_community_issues():
    """Get issues for a specific community"""
    try:
        username = session['username']
        community_id = request.args.get('community_id', type=int)
        status = request.args.get('status', 'active')  # 'active' or 'resolved'
        
        if not community_id:
            return jsonify({'success': False, 'error': 'Community ID required'})
        
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Get issues based on status
            if status == 'active':
                c.execute("""
                    SELECT ci.*, 
                           (SELECT COUNT(*) FROM issue_upvotes WHERE issue_id = ci.id) as upvote_count,
                           EXISTS(SELECT 1 FROM issue_upvotes WHERE issue_id = ci.id AND username = ?) as user_upvoted
                    FROM community_issues ci
                    WHERE ci.community_id = ? AND ci.resolved = 0
                    ORDER BY ci.reported_at DESC
                """, (username, community_id))
            else:  # resolved
                c.execute("""
                    SELECT ci.*, 
                           (SELECT COUNT(*) FROM issue_upvotes WHERE issue_id = ci.id) as upvote_count,
                           EXISTS(SELECT 1 FROM issue_upvotes WHERE issue_id = ci.id AND username = ?) as user_upvoted
                    FROM community_issues ci
                    WHERE ci.community_id = ? AND ci.resolved = 1
                    ORDER BY ci.resolved_at DESC
                """, (username, community_id))
            
            issues_raw = c.fetchall()
            issues = [dict(issue) for issue in issues_raw]
            
            # Format dates for display
            for issue in issues:
                # Convert reported_at to relative time
                reported_at = datetime.strptime(issue['reported_at'], '%Y-%m-%d %H:%M:%S')
                now = datetime.now()
                diff = now - reported_at
                
                if diff.days > 0:
                    issue['reported_at_display'] = f"{diff.days} day{'s' if diff.days > 1 else ''} ago"
                elif diff.seconds > 3600:
                    hours = diff.seconds // 3600
                    issue['reported_at_display'] = f"{hours} hour{'s' if hours > 1 else ''} ago"
                else:
                    minutes = diff.seconds // 60
                    issue['reported_at_display'] = f"{minutes} minute{'s' if minutes > 1 else ''} ago"
            
            return jsonify({'success': True, 'issues': issues})
            
    except Exception as e:
        logger.error(f"Error getting community issues: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/upvote_issue', methods=['POST'])
@login_required
def upvote_issue():
    """Upvote or remove upvote from an issue"""
    try:
        username = session['username']
        data = request.get_json()
        issue_id = data.get('issue_id')
        
        if not issue_id:
            return jsonify({'success': False, 'error': 'Issue ID required'})
        
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Check if user already upvoted
            c.execute("SELECT id FROM issue_upvotes WHERE issue_id = ? AND username = ?", 
                     (issue_id, username))
            existing_vote = c.fetchone()
            
            if existing_vote:
                # Remove upvote
                c.execute("DELETE FROM issue_upvotes WHERE issue_id = ? AND username = ?",
                         (issue_id, username))
                action = 'removed'
            else:
                # Add upvote
                c.execute("INSERT INTO issue_upvotes (issue_id, username, upvoted_at) VALUES (?, ?, ?)",
                         (issue_id, username, datetime.now().strftime('%Y-%m-%d %H:%M:%S')))
                action = 'added'
            
            # Update upvote count in issues table
            c.execute("""
                UPDATE community_issues 
                SET upvotes = (SELECT COUNT(*) FROM issue_upvotes WHERE issue_id = ?)
                WHERE id = ?
            """, (issue_id, issue_id))
            
            conn.commit()
            
            # Get updated count
            c.execute("SELECT upvotes FROM community_issues WHERE id = ?", (issue_id,))
            new_count = c.fetchone()['upvotes']
            
            return jsonify({'success': True, 'action': action, 'new_count': new_count})
            
    except Exception as e:
        logger.error(f"Error upvoting issue: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/resolve_issue', methods=['POST'])
@login_required
def resolve_issue():
    """Mark an issue as resolved"""
    try:
        username = session['username']
        data = request.get_json()
        issue_id = data.get('issue_id')
        
        if not issue_id:
            return jsonify({'success': False, 'error': 'Issue ID required'})
        
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Check if user is admin or community creator
            c.execute("""
                SELECT c.creator_username 
                FROM community_issues ci
                JOIN communities c ON ci.community_id = c.id
                WHERE ci.id = ?
            """, (issue_id,))
            
            community = c.fetchone()
            if not community:
                return jsonify({'success': False, 'error': 'Issue not found'})
            
            if username != 'admin' and username != community['creator_username']:
                return jsonify({'success': False, 'error': 'Unauthorized'})
            
            # Mark issue as resolved
            c.execute("""
                UPDATE community_issues 
                SET resolved = 1, resolved_by = ?, resolved_at = ?
                WHERE id = ?
            """, (username, datetime.now().strftime('%Y-%m-%d %H:%M:%S'), issue_id))
            
            conn.commit()
            
            return jsonify({'success': True, 'message': 'Issue marked as resolved'})
            
    except Exception as e:
        logger.error(f"Error resolving issue: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})
@app.route('/get_university_ads')
@login_required
def get_university_ads():
    """Get ads for a university community"""
    try:
        community_id = request.args.get('community_id', type=int)
        
        if not community_id:
            return jsonify({'success': False, 'message': 'Community ID is required'}), 400
        
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Get active ads for the community
            c.execute("""
                SELECT id, title, description, price, image_url, link_url
                FROM university_ads
                WHERE community_id = ? AND is_active = 1
                ORDER BY display_order ASC, created_at DESC
                LIMIT 10
            """, (community_id,))
            
            ads = []
            ad_ids = []
            for row in c.fetchall():
                ads.append({
                    'id': row['id'],
                    'title': row['title'],
                    'description': row['description'],
                    'price': row['price'],
                    'image': row['image_url'],
                    'link': row['link_url'] or '#'
                })
                ad_ids.append(row['id'])
            
            # Track impressions for displayed ads
            if ad_ids:
                c.execute(f"""
                    UPDATE university_ads 
                    SET impressions = impressions + 1 
                    WHERE id IN ({','.join('?' * len(ad_ids))})
                """, ad_ids)
                conn.commit()
            
            # If no ads, return sample data for demo
            if not ads:
                ads = [
                    {
                        'id': 0,
                        'title': 'University Hoodie',
                        'description': 'Official university hoodie',
                        'price': '$49.99',
                        'image': 'https://via.placeholder.com/250x180/2d8a7e/ffffff?text=University+Hoodie',
                        'link': '#'
                    },
                    {
                        'id': 0,
                        'title': 'Campus T-Shirt',
                        'description': 'Comfortable cotton t-shirt',
                        'price': '$24.99',
                        'image': 'https://via.placeholder.com/250x180/4db6ac/ffffff?text=Campus+Tee',
                        'link': '#'
                    },
                    {
                        'id': 0,
                        'title': 'Student Backpack',
                        'description': 'Durable laptop backpack',
                        'price': '$79.99',
                        'image': 'https://via.placeholder.com/250x180/37a69c/ffffff?text=Backpack',
                        'link': '#'
                    }
                ]
            
            return jsonify({'success': True, 'ads': ads})
            
    except Exception as e:
        logger.error(f"Error fetching university ads: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/track_ad_click', methods=['POST'])
@login_required
def track_ad_click():
    """Track when an ad is clicked"""
    try:
        data = request.get_json()
        ad_id = data.get('ad_id')
        
        if ad_id and ad_id != 0:  # Don't track sample ads
            with get_db_connection() as conn:
                c = conn.cursor()
                c.execute("UPDATE university_ads SET clicks = clicks + 1 WHERE id = ?", (ad_id,))
                conn.commit()
        
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Error tracking ad click: {e}")
        return jsonify({'success': False}), 500

@app.route('/manage_ads/<int:community_id>')
@login_required
def manage_ads(community_id):
    """Ads management page for community admins"""
    username = session.get('username')
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Check if user is admin or community creator
            c.execute("SELECT * FROM communities WHERE id = ?", (community_id,))
            community = c.fetchone()
            
            if not community:
                flash('Community not found', 'error')
                return redirect(url_for('communities'))
            
            if username != 'admin' and username != community['creator_username']:
                flash('You do not have permission to manage ads for this community', 'error')
                return redirect(url_for('community_feed', community_id=community_id))
            
            # Get all ads for this community
            c.execute("""
                SELECT id, title, description, price, image_url, link_url, 
                       is_active, display_order, clicks, impressions, created_at
                FROM university_ads
                WHERE community_id = ?
                ORDER BY display_order ASC, created_at DESC
            """, (community_id,))
            
            ads = []
            for row in c.fetchall():
                ads.append({
                    'id': row['id'],
                    'title': row['title'],
                    'description': row['description'],
                    'price': row['price'],
                    'image_url': row['image_url'],
                    'link_url': row['link_url'],
                    'is_active': row['is_active'],
                    'display_order': row['display_order'],
                    'clicks': row['clicks'],
                    'impressions': row['impressions'],
                    'ctr': f"{(row['clicks'] / row['impressions'] * 100):.2f}%" if row['impressions'] > 0 else "0%",
                    'created_at': row['created_at']
                })
            
            return render_template('manage_ads.html', 
                                 community=community, 
                                 ads=ads,
                                 username=username)
    except Exception as e:
        logger.error(f"Error in manage_ads: {e}")
        flash('An error occurred', 'error')
        return redirect(url_for('communities'))

@app.route('/add_ad/<int:community_id>', methods=['POST'])
@login_required
def add_ad(community_id):
    """Add a new ad"""
    username = session.get('username')
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Check permissions
            c.execute("SELECT * FROM communities WHERE id = ?", (community_id,))
            community = c.fetchone()
            
            if not community or (username != 'admin' and username != community['creator_username']):
                return jsonify({'success': False, 'message': 'Unauthorized'}), 403
            
            # Get form data
            title = request.form.get('title')
            description = request.form.get('description')
            price = request.form.get('price')
            image_url = request.form.get('image_url')
            link_url = request.form.get('link_url')
            display_order = request.form.get('display_order', 0)
            
            # Insert new ad
            c.execute("""
                INSERT INTO university_ads 
                (community_id, title, description, price, image_url, link_url, 
                 display_order, created_at, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (community_id, title, description, price, image_url, link_url,
                  display_order, datetime.now().isoformat(), username))
            conn.commit()
            
            flash('Ad added successfully!', 'success')
            return redirect(url_for('manage_ads', community_id=community_id))
            
    except Exception as e:
        logger.error(f"Error adding ad: {e}")
        flash('Error adding ad', 'error')
        return redirect(url_for('manage_ads', community_id=community_id))

@app.route('/toggle_ad/<int:ad_id>', methods=['POST'])
@login_required
def toggle_ad(ad_id):
    """Toggle ad active status"""
    username = session.get('username')
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Check permissions
            c.execute("""
                SELECT a.*, c.creator_username 
                FROM university_ads a
                JOIN communities c ON a.community_id = c.id
                WHERE a.id = ?
            """, (ad_id,))
            ad = c.fetchone()
            
            if not ad or (username != 'admin' and username != ad['creator_username']):
                return jsonify({'success': False, 'message': 'Unauthorized'}), 403
            
            # Toggle status
            new_status = 0 if ad['is_active'] else 1
            c.execute("UPDATE university_ads SET is_active = ? WHERE id = ?", (new_status, ad_id))
            conn.commit()
            
            return jsonify({'success': True, 'new_status': new_status})
            
    except Exception as e:
        logger.error(f"Error toggling ad: {e}")
        return jsonify({'success': False}), 500

@app.route('/update_ad/<int:ad_id>', methods=['POST'])
@login_required
def update_ad(ad_id):
    """Update an existing ad"""
    username = session.get('username')
    
    try:
        data = request.get_json()
        title = data.get('title', '').strip()
        description = data.get('description', '').strip()
        price = data.get('price', '').strip()
        image_url = data.get('image_url', '').strip()
        link_url = data.get('link_url', '').strip()
        
        if not title or not price or not image_url:
            return jsonify({'success': False, 'message': 'Title, price, and image URL are required'}), 400
            
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Check permissions
            c.execute("""
                SELECT a.*, c.creator_username 
                FROM university_ads a
                JOIN communities c ON a.community_id = c.id
                WHERE a.id = ?
            """, (ad_id,))
            ad = c.fetchone()
            
            if not ad or (username != 'admin' and username != ad['creator_username']):
                return jsonify({'success': False, 'message': 'Unauthorized'}), 403
            
            # Update ad
            c.execute("""
                UPDATE university_ads 
                SET title = ?, description = ?, price = ?, image_url = ?, link_url = ?
                WHERE id = ?
            """, (title, description, price, image_url, link_url, ad_id))
            conn.commit()
            
            return jsonify({'success': True})
            
    except Exception as e:
        logger.error(f"Error updating ad: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/delete_ad/<int:ad_id>', methods=['POST'])
@login_required
def delete_ad(ad_id):
    """Delete an ad"""
    username = session.get('username')
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Check permissions
            c.execute("""
                SELECT a.*, c.creator_username 
                FROM university_ads a
                JOIN communities c ON a.community_id = c.id
                WHERE a.id = ?
            """, (ad_id,))
            ad = c.fetchone()
            
            if not ad or (username != 'admin' and username != ad['creator_username']):
                return jsonify({'success': False, 'message': 'Unauthorized'}), 403
            
            # Delete ad
            c.execute("DELETE FROM university_ads WHERE id = ?", (ad_id,))
            conn.commit()
            
            return jsonify({'success': True})
            
    except Exception as e:
        logger.error(f"Error deleting ad: {e}")
        return jsonify({'success': False}), 500

@app.route('/community/<int:community_id>/resources')
@login_required
def community_resources(community_id):
    """Community resource sharing forum - mobile -> React, desktop -> HTML"""
    username = session.get('username')
    # UA-based routing
    try:
        ua = request.headers.get('User-Agent', '')
        is_mobile = any(k in ua for k in ['Mobi', 'Android', 'iPhone', 'iPad'])
        if is_mobile:
            base_dir = os.path.dirname(os.path.abspath(__file__))
            dist_dir = os.path.join(base_dir, 'client', 'dist')
            index_path = os.path.join(dist_dir, 'index.html')
            if os.path.exists(index_path):
                return send_from_directory(dist_dir, 'index.html')
    except Exception as _e:
        logger.warning(f"React resources not available: {_e}")

    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Get community info
            c.execute("SELECT * FROM communities WHERE id = ?", (community_id,))
            community = c.fetchone()
            if not community:
                flash('Community not found', 'error')
                return redirect(url_for('communities'))
            
            # Get resource posts for this community with profile pictures
            c.execute("""
                SELECT p.*,
                       up.profile_picture,
                       (SELECT COUNT(*) FROM resource_comments WHERE post_id = p.id) as comment_count,
                       (SELECT COUNT(*) FROM resource_upvotes WHERE post_id = p.id) as upvote_count,
                       EXISTS(SELECT 1 FROM resource_upvotes WHERE post_id = p.id AND username = ?) as user_upvoted
                FROM resource_posts p
                LEFT JOIN user_profiles up ON p.username = up.username
                WHERE p.community_id = ?
                ORDER BY p.is_pinned DESC, p.created_at DESC
            """, (username, community_id))
            
            posts = []
            for row in c.fetchall():
                posts.append(dict(row))
            
            return render_template('community_resources.html', 
                                 community=dict(community), 
                                 posts=posts,
                                 username=username)
                                 
    except Exception as e:
        logger.error(f"Error loading community resources: {e}")
        flash('Error loading resources', 'error')
        return redirect(url_for('community_feed', community_id=community_id))

@app.route('/community/<int:community_id>/resources/create', methods=['POST'])
@login_required
def create_resource_post(community_id):
    """Create a new resource post"""
    username = session.get('username')
    
    try:
        data = request.get_json()
        title = data.get('title', '').strip()
        content = data.get('content', '').strip()
        category = data.get('category', 'General')
        attachment_url = data.get('attachment_url', '')
        
        if not title or not content:
            return jsonify({'success': False, 'message': 'Title and content are required'}), 400
            
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Create post directly (access control is handled at page level)
            c.execute("""
                INSERT INTO resource_posts 
                (community_id, username, title, content, category, attachment_url, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (community_id, username, title, content, category, attachment_url, 
                  datetime.now().isoformat()))
            
            conn.commit()
            post_id = c.lastrowid
            
            return jsonify({'success': True, 'post_id': post_id})
            
    except Exception as e:
        logger.error(f"Error creating resource post: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500
def upvote_resource_post(post_id):
    """Toggle upvote on a resource post"""
    username = session.get('username')
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Check if already upvoted
            c.execute("""
                SELECT 1 FROM resource_upvotes 
                WHERE post_id = ? AND username = ?
            """, (post_id, username))
            
            if c.fetchone():
                # Remove upvote
                c.execute("""
                    DELETE FROM resource_upvotes 
                    WHERE post_id = ? AND username = ?
                """, (post_id, username))
                
                c.execute("""
                    UPDATE resource_posts 
                    SET upvotes = upvotes - 1 
                    WHERE id = ?
                """, (post_id,))
                
                action = 'removed'
            else:
                # Add upvote
                c.execute("""
                    INSERT INTO resource_upvotes (post_id, username, created_at)
                    VALUES (?, ?, ?)
                """, (post_id, username, datetime.now().isoformat()))
                
                c.execute("""
                    UPDATE resource_posts 
                    SET upvotes = upvotes + 1 
                    WHERE id = ?
                """, (post_id,))
                
                action = 'added'
            
            conn.commit()
            
            # Get updated count
            c.execute("SELECT upvotes FROM resource_posts WHERE id = ?", (post_id,))
            upvotes = c.fetchone()['upvotes']
            
            return jsonify({'success': True, 'action': action, 'upvotes': upvotes})
            
    except Exception as e:
        logger.error(f"Error upvoting post: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/resource/post/<int:post_id>/delete', methods=['DELETE'])
@login_required
def delete_resource_post(post_id):
    """Delete a resource post"""
    username = session.get('username')
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Get post details and community info
            c.execute("""
                SELECT p.*, c.creator_username 
                FROM resource_posts p
                JOIN communities c ON p.community_id = c.id
                WHERE p.id = ?
            """, (post_id,))
            
            post = c.fetchone()
            
            if not post:
                return jsonify({'success': False, 'message': 'Post not found'}), 404
            
            # Check permissions (post creator, admin, or community creator)
            if username != post['username'] and username != 'admin' and username != post['creator_username']:
                return jsonify({'success': False, 'message': 'Unauthorized'}), 403
            
            # Delete the post (cascade will handle comments and upvotes)
            c.execute("DELETE FROM resource_posts WHERE id = ?", (post_id,))
            conn.commit()
            
            return jsonify({'success': True, 'message': 'Post deleted successfully'})
            
    except Exception as e:
        logger.error(f"Error deleting post: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/post/<int:post_id>/delete', methods=['DELETE'])
@login_required
def delete_community_post(post_id):
    """Delete a community post"""
    username = session.get('username')
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Get post details
            c.execute("SELECT * FROM posts WHERE id = ?", (post_id,))
            post = c.fetchone()
            
            if not post:
                return jsonify({'success': False, 'message': 'Post not found'}), 404
            
            # Check permissions using the new permission system
            if not has_post_delete_permission(username, post['username'], post['community_id']):
                return jsonify({'success': False, 'message': 'Unauthorized'}), 403
            
            # Delete the post
            c.execute("DELETE FROM posts WHERE id = ?", (post_id,))
            conn.commit()
            
            return jsonify({'success': True, 'message': 'Post deleted successfully'})
            
    except Exception as e:
        logger.error(f"Error deleting community post: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/community/<int:community_id>/appoint_admin', methods=['POST'])
@login_required
def appoint_community_admin(community_id):
    """Appoint a community admin (only community owner or app admin can do this)"""
    username = session.get('username')
    
    try:
        # Check if user has permission to appoint admins
        if not is_app_admin(username) and not is_community_owner(username, community_id):
            return jsonify({'success': False, 'message': 'Only community owner or app admin can appoint admins'}), 403
        
        data = request.get_json()
        new_admin = data.get('username', '').strip()
        
        if not new_admin:
            return jsonify({'success': False, 'message': 'Username is required'}), 400
            
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Check if user exists
            c.execute("SELECT 1 FROM users WHERE username = ?", (new_admin,))
            if not c.fetchone():
                return jsonify({'success': False, 'message': 'User not found'}), 404
            
            # Check if already an admin
            c.execute("SELECT 1 FROM community_admins WHERE community_id = ? AND username = ?", 
                     (community_id, new_admin))
            if c.fetchone():
                return jsonify({'success': False, 'message': 'User is already an admin'}), 400
            
            # Appoint as admin
            c.execute("""
                INSERT INTO community_admins (community_id, username, appointed_by, appointed_at)
                VALUES (?, ?, ?, ?)
            """, (community_id, new_admin, username, datetime.now().isoformat()))
            
            conn.commit()
            
            return jsonify({'success': True, 'message': f'{new_admin} appointed as community admin'})
            
    except Exception as e:
        logger.error(f"Error appointing admin: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/community/<int:community_id>/remove_admin', methods=['POST'])
@login_required
def remove_community_admin(community_id):
    """Remove a community admin (only community owner or app admin can do this)"""
    username = session.get('username')
    
    try:
        # Check if user has permission to remove admins
        if not is_app_admin(username) and not is_community_owner(username, community_id):
            return jsonify({'success': False, 'message': 'Only community owner or app admin can remove admins'}), 403
        
        data = request.get_json()
        admin_to_remove = data.get('username', '').strip()
        
        if not admin_to_remove:
            return jsonify({'success': False, 'message': 'Username is required'}), 400
            
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Remove admin
            c.execute("DELETE FROM community_admins WHERE community_id = ? AND username = ?", 
                     (community_id, admin_to_remove))
            
            if c.rowcount == 0:
                return jsonify({'success': False, 'message': 'User is not an admin'}), 404
            
            conn.commit()
            
            return jsonify({'success': True, 'message': f'{admin_to_remove} removed as community admin'})
            
    except Exception as e:
        logger.error(f"Error removing admin: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/community/<int:community_id>/admins')
@login_required
def get_community_admins(community_id):
    """Get list of community admins"""
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("""
                SELECT ca.*, u.email 
                FROM community_admins ca
                JOIN users u ON ca.username = u.username
                WHERE ca.community_id = ?
                ORDER BY ca.appointed_at DESC
            """, (community_id,))
            
            admins = []
            for row in c.fetchall():
                admins.append(dict(row))
            
            return jsonify({'success': True, 'admins': admins})
            
    except Exception as e:
        logger.error(f"Error getting community admins: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500
@app.route('/community/<int:community_id>/clubs')
@login_required
def clubs_directory(community_id):
    """Clubs and organizations directory for university communities"""
    username = session.get('username')
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Get community info
            c.execute("SELECT * FROM communities WHERE id = ?", (community_id,))
            community = c.fetchone()
            if not community:
                flash('Community not found', 'error')
                return redirect(url_for('communities'))
            
            # Check if this is a parent university community
            if community['type'] != 'University' or community['parent_community_id']:
                flash('Clubs directory is only available for main university communities', 'error')
                return redirect(url_for('community_feed', community_id=community_id))
            
            # Get all clubs for this community
            c.execute("""
                SELECT c.*, 
                       (SELECT COUNT(*) FROM club_members WHERE club_id = c.id) as member_count,
                       EXISTS(SELECT 1 FROM club_members WHERE club_id = c.id AND username = ?) as is_member,
                       (SELECT role FROM club_members WHERE club_id = c.id AND username = ?) as user_role
                FROM clubs c
                WHERE c.community_id = ? AND c.is_active = 1
                ORDER BY c.name
            """, (username, username, community_id))
            
            clubs = []
            for row in c.fetchall():
                clubs.append(dict(row))
            
            return render_template('clubs_directory.html', 
                                 community=dict(community), 
                                 clubs=clubs,
                                 username=username)
                                 
    except Exception as e:
        logger.error(f"Error loading clubs directory: {e}")
        flash('Error loading clubs directory', 'error')
        return redirect(url_for('community_feed', community_id=community_id))

@app.route('/community/<int:community_id>/clubs/create', methods=['POST'])
@login_required
def create_club(community_id):
    """Create a new club"""
    username = session.get('username')
    
    try:
        data = request.get_json()
        name = data.get('name', '').strip()
        description = data.get('description', '').strip()
        category = data.get('category', 'General')
        contact_email = data.get('contact_email', '')
        contact_person = data.get('contact_person', '')
        meeting_schedule = data.get('meeting_schedule', '')
        location = data.get('location', '')
        website_url = data.get('website_url', '')
        
        if not name or not description:
            return jsonify({'success': False, 'message': 'Name and description are required'}), 400
            
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Create club
            c.execute("""
                INSERT INTO clubs 
                (community_id, name, description, category, contact_email, contact_person,
                 meeting_schedule, location, website_url, created_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (community_id, name, description, category, contact_email, contact_person,
                  meeting_schedule, location, website_url, username, datetime.now().isoformat()))
            
            club_id = c.lastrowid
            
            # Add creator as president
            c.execute("""
                INSERT INTO club_members (club_id, username, role, joined_at)
                VALUES (?, ?, 'president', ?)
            """, (club_id, username, datetime.now().isoformat()))
            
            conn.commit()
            
            return jsonify({'success': True, 'club_id': club_id})
            
    except Exception as e:
        logger.error(f"Error creating club: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/club/<int:club_id>/join', methods=['POST'])
@login_required
def join_club(club_id):
    """Join or leave a club"""
    username = session.get('username')
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Check if already a member
            c.execute("""
                SELECT 1 FROM club_members 
                WHERE club_id = ? AND username = ?
            """, (club_id, username))
            
            if c.fetchone():
                # Leave club
                c.execute("""
                    DELETE FROM club_members 
                    WHERE club_id = ? AND username = ?
                """, (club_id, username))
                action = 'left'
            else:
                # Join club
                c.execute("""
                    INSERT INTO club_members (club_id, username, joined_at)
                    VALUES (?, ?, ?)
                """, (club_id, username, datetime.now().isoformat()))
                action = 'joined'
            
            conn.commit()
            
            # Get updated member count
            c.execute("SELECT COUNT(*) as count FROM club_members WHERE club_id = ?", (club_id,))
            member_count = c.fetchone()['count']
            
            return jsonify({'success': True, 'action': action, 'member_count': member_count})
            
    except Exception as e:
        logger.error(f"Error joining/leaving club: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/community/<int:community_id>/feedback', methods=['POST'])
@login_required
def submit_feedback(community_id):
    """Submit anonymous feedback"""
    try:
        data = request.get_json()
        feedback_text = data.get('feedback', '').strip()
        category = data.get('category', 'General')
        priority = data.get('priority', 'normal')
        
        if not feedback_text:
            return jsonify({'success': False, 'message': 'Feedback text is required'}), 400
            
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Submit feedback
            c.execute("""
                INSERT INTO anonymous_feedback 
                (community_id, feedback_text, category, priority, submitted_at)
                VALUES (?, ?, ?, ?, ?)
            """, (community_id, feedback_text, category, priority, datetime.now().isoformat()))
            
            conn.commit()
            
            return jsonify({'success': True, 'message': 'Feedback submitted successfully'})
            
    except Exception as e:
        logger.error(f"Error submitting feedback: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/community/<int:community_id>/members/list')
@login_required
def get_community_members_list(community_id):
    """Get list of community members - visible to all members of the community"""
    try:
        username = session.get('username')
        logger.info(f"Fetching members for community {community_id} requested by {username}")
        
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # First check if community exists
            c.execute("SELECT name FROM communities WHERE id = ?", (community_id,))
            community = c.fetchone()
            if not community:
                logger.warning(f"Community {community_id} not found")
                return jsonify({'success': False, 'message': 'Community not found'}), 404

            # Ensure the requester is a member of the community
            c.execute("SELECT id FROM users WHERE username = ?", (username,))
            user_row = c.fetchone()
            if not user_row:
                return jsonify({'success': False, 'message': 'User not found'}), 404
            requester_user_id = user_row['id'] if hasattr(user_row, 'keys') else user_row[0]
            c.execute("""
                SELECT 1 FROM user_communities 
                WHERE user_id = ? AND community_id = ?
            """, (requester_user_id, community_id))
            is_member = c.fetchone() is not None
            if not is_member:
                logger.info(f"User {username} attempted to view members of community {community_id} without membership")
                return jsonify({'success': False, 'message': 'Forbidden: not a member of this community'}), 403
            
            # Get community members with profile pictures
            c.execute("""
                SELECT DISTINCT u.username, up.profile_picture
                FROM user_communities uc
                JOIN users u ON uc.user_id = u.id
                LEFT JOIN user_profiles up ON u.username = up.username
                WHERE uc.community_id = ?
                ORDER BY u.username
            """, (community_id,))
            
            members = []
            rows = c.fetchall()
            logger.info(f"Found {len(rows)} members in community {community_id}")
            
            for row in rows:
                members.append({
                    'username': row['username'],
                    'profile_picture': row['profile_picture'],
                    'is_current_user': row['username'] == username
                })
            
            # Fetch community join code
            c.execute("SELECT join_code FROM communities WHERE id = ?", (community_id,))
            code_row = c.fetchone()
            join_code = code_row['join_code'] if code_row and 'join_code' in code_row.keys() else None

            return jsonify({
                'success': True,
                'members': members,
                'total': len(members),
                'community_name': community['name'],
                'community_code': join_code
            })
            
    except Exception as e:
        logger.error(f"Error fetching community members for community {community_id}: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/community/<int:community_id>/event/<int:event_id>/rsvp')
@login_required
def event_rsvp_page(community_id, event_id):
    """Display RSVP page for an event invitation"""
    username = session.get('username')
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Get event details
            c.execute("""
                SELECT e.*, c.name as community_name, c.background_color
                FROM calendar_events e
                JOIN communities c ON e.community_id = c.id
                WHERE e.id = ? AND e.community_id = ?
            """, (event_id, community_id))
            
            event = c.fetchone()
            if not event:
                flash('Event not found', 'error')
                return redirect(url_for('community_feed', community_id=community_id))
            
            # Check if user is invited
            c.execute("""
                SELECT * FROM event_invitations
                WHERE event_id = ? AND invited_username = ?
            """, (event_id, username))
            
            invitation = c.fetchone()
            
            # Get current RSVP status
            c.execute("""
                SELECT response FROM event_rsvps
                WHERE event_id = ? AND username = ?
            """, (event_id, username))
            
            rsvp = c.fetchone()
            
            # Get RSVP counts
            c.execute("""
                SELECT response, COUNT(*) as count
                FROM event_rsvps
                WHERE event_id = ?
                GROUP BY response
            """, (event_id,))
            
            rsvp_counts = {'going': 0, 'maybe': 0, 'not_going': 0}
            for row in c.fetchall():
                rsvp_counts[row['response']] = row['count']
            
            # Mark invitation as viewed
            if invitation:
                c.execute("""
                    UPDATE event_invitations
                    SET viewed = 1
                    WHERE event_id = ? AND invited_username = ?
                """, (event_id, username))
                conn.commit()
            
            return render_template('event_rsvp.html',
                                   event=event,
                                   community_id=community_id,
                                   invitation=invitation,
                                   current_rsvp=rsvp['response'] if rsvp else None,
                                   rsvp_counts=rsvp_counts)
    
    except Exception as e:
        logger.error(f"Error displaying RSVP page: {e}")
        flash('An error occurred', 'error')
        return redirect(url_for('community_feed', community_id=community_id))

@app.route('/event/<int:event_id>/rsvp', methods=['POST'])
@login_required
def rsvp_event(event_id):
    """RSVP to a calendar event (accepts JSON or form), returns updated counts including no_response and user_rsvp"""
    username = session.get('username')
    try:
        data = request.get_json(silent=True) or {}
        response = (request.form.get('response') or data.get('response') or '').strip()
        note = (request.form.get('note') or data.get('note') or '').strip()
        if response not in ('going','maybe','not_going'):
            return jsonify({'success': False, 'message': 'Invalid response'}), 400
        with get_db_connection() as conn:
            c = conn.cursor()
            # Ensure event exists and get community_id
            c.execute("SELECT community_id FROM calendar_events WHERE id = ?", (event_id,))
            row = c.fetchone()
            if not row:
                return jsonify({'success': False, 'message': 'Event not found'}), 404
            community_id_val = row['community_id'] if hasattr(row, 'keys') else row[0]
            # Upsert RSVP
            c.execute("""
                INSERT INTO event_rsvps (event_id, username, response, note, responded_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(event_id, username) DO UPDATE SET response=excluded.response, note=excluded.note, responded_at=excluded.responded_at
            """, (event_id, username, response, note, datetime.now().isoformat()))
            # Counts
            c.execute("SELECT response, COUNT(*) as count FROM event_rsvps WHERE event_id=? GROUP BY response", (event_id,))
            counts = {'going': 0, 'maybe': 0, 'not_going': 0}
            for r in c.fetchall():
                counts[r['response']] = r['count']
            no_response = 0
            if community_id_val:
                try:
                    c.execute("SELECT COUNT(DISTINCT u.username) FROM user_communities uc JOIN users u ON uc.user_id=u.id WHERE uc.community_id=?", (community_id_val,))
                    total_members = (c.fetchone() or [0])[0]
                    c.execute("SELECT COUNT(DISTINCT username) FROM event_rsvps WHERE event_id=?", (event_id,))
                    responded = (c.fetchone() or [0])[0]
                    no_response = max(0, (total_members or 0) - (responded or 0))
                except Exception:
                    no_response = 0
            counts['no_response'] = no_response
            conn.commit()
        return jsonify({'success': True, 'counts': counts, 'user_rsvp': response})
    except Exception as e:
        logger.error(f"Error updating RSVP: {e}")
        return jsonify({'success': False, 'message': 'Server error'}), 500

@app.route('/event/<int:event_id>/rsvps')
@login_required
def get_event_rsvps(event_id):
    """Get all RSVPs for an event"""
    username = session.get('username')
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Get event details
            c.execute("""
                SELECT e.*, c.name as community_name
                FROM calendar_events e
                JOIN communities c ON e.community_id = c.id
                WHERE e.id = ?
            """, (event_id,))
            
            event = c.fetchone()
            if not event:
                return jsonify({'success': False, 'message': 'Event not found'}), 404
            
            # Get all RSVPs with user profiles
            c.execute("""
                SELECT r.*, up.profile_picture
                FROM event_rsvps r
                LEFT JOIN user_profiles up ON r.username = up.username
                WHERE r.event_id = ?
                ORDER BY r.response, r.responded_at DESC
            """, (event_id,))
            
            rsvps = []
            for row in c.fetchall():
                rsvps.append({
                    'username': row['username'],
                    'response': row['response'],
                    'note': row['note'],
                    'responded_at': row['responded_at'],
                    'profile_picture': row['profile_picture']
                })
            
            # Get current user's RSVP
            c.execute("""
                SELECT response FROM event_rsvps
                WHERE event_id = ? AND username = ?
            """, (event_id, username))
            
            user_rsvp = c.fetchone()
            
            # Get counts
            counts = {'going': 0, 'maybe': 0, 'not_going': 0}
            for rsvp in rsvps:
                counts[rsvp['response']] += 1
            
            return jsonify({
                'success': True,
                'event': dict(event),
                'rsvps': rsvps,
                'counts': counts,
                'user_rsvp': user_rsvp['response'] if user_rsvp else None
            })
            
    except Exception as e:
        logger.error(f"Error fetching RSVPs: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/event/<int:event_id>/rsvp', methods=['DELETE'])
@login_required
def cancel_rsvp(event_id):
    """Cancel RSVP for an event"""
    username = session.get('username')
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            c.execute("""
                DELETE FROM event_rsvps
                WHERE event_id = ? AND username = ?
            """, (event_id, username))
            
            if c.rowcount == 0:
                return jsonify({'success': False, 'message': 'No RSVP found'}), 404
            
            conn.commit()
            
            # Get updated counts
            c.execute("""
                SELECT response, COUNT(*) as count
                FROM event_rsvps
                WHERE event_id = ?
                GROUP BY response
            """, (event_id,))
            
            counts = {'going': 0, 'maybe': 0, 'not_going': 0}
            for row in c.fetchall():
                counts[row['response']] = row['count']
            
            return jsonify({
                'success': True,
                'message': 'RSVP cancelled',
                'counts': counts
            })
            
    except Exception as e:
        logger.error(f"Error cancelling RSVP: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/community/<int:community_id>/feedback/view')
@login_required
def view_feedback(community_id):
    """View feedback (admin/creator only)"""
    username = session.get('username')
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Check permissions
            c.execute("SELECT creator_username FROM communities WHERE id = ?", (community_id,))
            community = c.fetchone()
            
            if not community or (username != 'admin' and username != community['creator_username']):
                return jsonify({'success': False, 'message': 'Unauthorized'}), 403
            
            # Get feedback
            c.execute("""
                SELECT * FROM anonymous_feedback 
                WHERE community_id = ?
                ORDER BY submitted_at DESC
            """, (community_id,))
            
            feedback = []
            for row in c.fetchall():
                feedback.append(dict(row))
            
            return jsonify({'success': True, 'feedback': feedback})
            
    except Exception as e:
        logger.error(f"Error viewing feedback: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/admin/deactivate_user/<username>', methods=['POST'])
@login_required
def deactivate_user(username):
    """Deactivate/reactivate a user (app admin only)"""
    current_user = session.get('username')
    
    if not is_app_admin(current_user):
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403
    
    if username == 'admin':
        return jsonify({'success': False, 'message': 'Cannot deactivate app admin'}), 400
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Toggle user active status
            c.execute("SELECT is_active FROM users WHERE username = ?", (username,))
            user = c.fetchone()
            
            if not user:
                return jsonify({'success': False, 'message': 'User not found'}), 404
            
            new_status = 0 if user['is_active'] else 1
            c.execute("UPDATE users SET is_active = ? WHERE username = ?", (new_status, username))
            conn.commit()
            
            action = 'activated' if new_status else 'deactivated'
            return jsonify({'success': True, 'message': f'User {username} has been {action}'})
            
    except Exception as e:
        logger.error(f"Error deactivating user: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/admin/deactivate_community/<int:community_id>', methods=['POST'])
@login_required
def deactivate_community(community_id):
    """Deactivate/reactivate a community (app admin only)"""
    current_user = session.get('username')
    
    if not is_app_admin(current_user):
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Toggle community active status
            c.execute("SELECT is_active, name FROM communities WHERE id = ?", (community_id,))
            community = c.fetchone()
            
            if not community:
                return jsonify({'success': False, 'message': 'Community not found'}), 404
            
            new_status = 0 if community['is_active'] else 1
            c.execute("UPDATE communities SET is_active = ? WHERE id = ?", (new_status, community_id))
            conn.commit()
            
            action = 'activated' if new_status else 'deactivated'
            return jsonify({'success': True, 'message': f'Community {community["name"]} has been {action}'})
            
    except Exception as e:
        logger.error(f"Error deactivating community: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500
@app.route('/gym')
@login_required
def gym():
    return redirect(url_for('workout_tracking'))
def admin_user_statistics():
    """Admin endpoint to view user activity statistics"""
    username = session.get('username')
    
    # Check if user is admin
    if username != 'admin':
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Get user statistics
            c.execute("""
                SELECT 
                    u.username,
                    u.subscription,
                    u.created_at,
                    COUNT(DISTINCT lh.id) as login_count,
                    COUNT(DISTINCT vh.id) as total_visits,
                    COUNT(DISTINCT vh.community_id) as unique_communities_visited,
                    MAX(lh.login_time) as last_login
                FROM users u
                LEFT JOIN user_login_history lh ON u.username = lh.username
                LEFT JOIN community_visit_history vh ON u.username = vh.username
                GROUP BY u.username
                ORDER BY login_count DESC, total_visits DESC
            """)
            
            user_stats = []
            for row in c.fetchall():
                user_stats.append({
                    'username': row['username'],
                    'subscription': row['subscription'],
                    'created_at': row['created_at'],
                    'login_count': row['login_count'],
                    'total_visits': row['total_visits'],
                    'unique_communities': row['unique_communities_visited'],
                    'last_login': row['last_login'] or 'Never'
                })
            
            # Get community visit details for each user
            c.execute("""
                SELECT 
                    vh.username,
                    c.name as community_name,
                    COUNT(*) as visit_count
                FROM community_visit_history vh
                JOIN communities c ON vh.community_id = c.id
                GROUP BY vh.username, vh.community_id, c.name
                ORDER BY vh.username, visit_count DESC
            """)
            
            user_community_visits = {}
            for row in c.fetchall():
                if row['username'] not in user_community_visits:
                    user_community_visits[row['username']] = []
                user_community_visits[row['username']].append({
                    'community': row['community_name'],
                    'visits': row['visit_count']
                })
            
            return jsonify({
                'success': True,
                'user_stats': user_stats,
                'community_visits': user_community_visits
            })
            
    except Exception as e:
        logger.error(f"Error getting user statistics: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500
@app.route('/admin/ads_overview')
@login_required
def admin_ads_overview():
    """Admin page to view all ads performance across communities"""
    username = session.get('username')
    
    # Check if user is admin
    if username != 'admin':
        flash('Access denied. Admin only.', 'error')
        return redirect(url_for('index'))
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Get all communities with their parent relationships and ads
            c.execute("""
                SELECT 
                    c.id,
                    c.name,
                    c.type,
                    c.parent_community_id,
                    pc.name as parent_name,
                    COUNT(DISTINCT ua.id) as total_ads,
                    COALESCE(SUM(ua.impressions), 0) as total_impressions,
                    COALESCE(SUM(ua.clicks), 0) as total_clicks,
                    COALESCE(SUM(CASE WHEN ua.is_active = 1 THEN 1 ELSE 0 END), 0) as active_ads
                FROM communities c
                LEFT JOIN communities pc ON c.parent_community_id = pc.id
                LEFT JOIN university_ads ua ON c.id = ua.community_id
                WHERE c.type = 'University'
                GROUP BY c.id, c.name, c.type, c.parent_community_id, pc.name
                ORDER BY 
                    CASE WHEN c.parent_community_id IS NULL THEN 0 ELSE 1 END,
                    COALESCE(pc.name, c.name),
                    c.parent_community_id IS NULL DESC,
                    c.name
            """)
            
            # Organize communities by parent groups
            parent_groups = {}
            communities_data = []
            
            for row in c.fetchall():
                ctr = 0
                if row['total_impressions'] > 0:
                    ctr = round((row['total_clicks'] / row['total_impressions']) * 100, 2)
                
                community = {
                    'id': row['id'],
                    'name': row['name'],
                    'type': row['type'],
                    'parent_id': row['parent_community_id'],
                    'parent_name': row['parent_name'],
                    'total_ads': row['total_ads'],
                    'active_ads': row['active_ads'],
                    'impressions': row['total_impressions'],
                    'clicks': row['total_clicks'],
                    'ctr': ctr
                }
                communities_data.append(community)
                
                # Organize into parent groups
                if row['parent_community_id'] is None:
                    # This is a parent community
                    if row['name'] not in parent_groups:
                        parent_groups[row['name']] = {
                            'parent': community,
                            'children': []
                        }
                    else:
                        parent_groups[row['name']]['parent'] = community
                else:
                    # This is a child community
                    parent_name = row['parent_name']
                    if parent_name not in parent_groups:
                        parent_groups[parent_name] = {
                            'parent': None,
                            'children': []
                        }
                    parent_groups[parent_name]['children'].append(community)
            
            # Get detailed ads for each community
            c.execute("""
                SELECT 
                    ua.*,
                    c.name as community_name,
                    pc.name as parent_community_name
                FROM university_ads ua
                JOIN communities c ON ua.community_id = c.id
                LEFT JOIN communities pc ON c.parent_community_id = pc.id
                ORDER BY pc.name NULLS FIRST, c.name, ua.created_at DESC
            """)
            
            all_ads = []
            for row in c.fetchall():
                ad_ctr = 0
                if row['impressions'] and row['impressions'] > 0:
                    ad_ctr = round((row['clicks'] / row['impressions']) * 100, 2)
                
                all_ads.append({
                    'id': row['id'],
                    'community_id': row['community_id'],
                    'community_name': row['community_name'],
                    'parent_community_name': row['parent_community_name'],
                    'title': row['title'],
                    'description': row['description'],
                    'price': row['price'],
                    'image_url': row['image_url'],
                    'link_url': row['link_url'],
                    'is_active': row['is_active'],
                    'impressions': row['impressions'] or 0,
                    'clicks': row['clicks'] or 0,
                    'ctr': ad_ctr,
                    'created_at': row['created_at'],
                    'created_by': row['created_by']
                })
            
            # Calculate overall stats
            total_communities = len(communities_data)
            total_ads = sum(c['total_ads'] for c in communities_data)
            total_active = sum(c['active_ads'] for c in communities_data)
            total_impressions = sum(c['impressions'] for c in communities_data)
            total_clicks = sum(c['clicks'] for c in communities_data)
            overall_ctr = 0
            if total_impressions > 0:
                overall_ctr = round((total_clicks / total_impressions) * 100, 2)
            
            return render_template('admin_ads_overview.html',
                                 communities=communities_data,
                                 parent_groups=parent_groups,
                                 all_ads=all_ads,
                                 total_communities=total_communities,
                                 total_ads=total_ads,
                                 total_active=total_active,
                                 total_impressions=total_impressions,
                                 total_clicks=total_clicks,
                                 overall_ctr=overall_ctr)
                                 
    except Exception as e:
        logger.error(f"Error loading admin ads overview: {e}")
        flash('Error loading ads overview', 'error')
        return redirect(url_for('admin'))

@app.route('/get_calendar_events')
@login_required
def get_calendar_events():
    """Get all calendar events"""
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Get all calendar events (with backward compatibility for time field)
            c.execute("""
                SELECT id, username, title, date, 
                       COALESCE(end_date, date) as end_date,
                       COALESCE(start_time, time) as start_time,
                       end_time,
                       time, description, created_at, community_id
                FROM calendar_events
                ORDER BY date ASC, COALESCE(start_time, time) ASC
            """)
            events_raw = c.fetchall()
            
            events = []
            for event in events_raw:
                event_id = event['id']
                
                # Get RSVP counts for this event
                c.execute("""
                    SELECT response, COUNT(*) as count
                    FROM event_rsvps
                    WHERE event_id = ?
                    GROUP BY response
                """, (event_id,))
                
                rsvp_counts = {'going': 0, 'maybe': 0, 'not_going': 0}
                for row in c.fetchall():
                    rsvp_counts[row['response']] = row['count']
                # Derive no_response based on community size if possible
                no_response = 0
                community_id_val = event['community_id'] if hasattr(event, 'keys') else None
                if community_id_val:
                    try:
                        c.execute("SELECT COUNT(DISTINCT u.username) FROM user_communities uc JOIN users u ON uc.user_id=u.id WHERE uc.community_id=?", (community_id_val,))
                        total_members_row = c.fetchone()
                        total_members = total_members_row[0] if total_members_row is not None else 0
                        c.execute("SELECT COUNT(DISTINCT username) FROM event_rsvps WHERE event_id=?", (event_id,))
                        responded_row = c.fetchone()
                        responded = responded_row[0] if responded_row is not None else 0
                        no_response = max(0, (total_members or 0) - (responded or 0))
                    except Exception:
                        no_response = 0
                rsvp_counts['no_response'] = no_response
                
                # Get current user's RSVP if logged in
                username = session.get('username')
                user_rsvp = None
                is_invited = False
                if username:
                    c.execute("""
                        SELECT response FROM event_rsvps
                        WHERE event_id = ? AND username = ?
                    """, (event_id, username))
                    result = c.fetchone()
                    if result:
                        user_rsvp = result['response']
                    
                    # Check if user is invited
                    c.execute("""
                        SELECT 1 FROM event_invitations
                        WHERE event_id = ? AND invited_username = ?
                    """, (event_id, username))
                    is_invited = c.fetchone() is not None
                
                events.append({
                    'id': event['id'],
                    'username': event['username'],
                    'title': event['title'],
                    'date': event['date'],
                    'end_date': event['end_date'],
                    'time': event['time'],  # Keep for backward compatibility
                    'start_time': event['start_time'],
                    'end_time': event['end_time'],
                    'description': event['description'],
                    'created_at': event['created_at'],
                    'community_id': event['community_id'],
                    'rsvp_counts': rsvp_counts,
                    'user_rsvp': user_rsvp,
                    'total_rsvps': sum(rsvp_counts.values()),
                    'is_invited': is_invited,
                    'is_creator': event['username'] == username
                })
            
            return jsonify({'success': True, 'events': events})
            
    except Exception as e:
        logger.error(f"Error getting calendar events: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/add_calendar_event', methods=['POST'])
@login_required
def add_calendar_event():
    """Add a new calendar event with invitations"""
    try:
        username = session['username']
        title = request.form.get('title', '').strip()
        date = request.form.get('date', '').strip()
        end_date = request.form.get('end_date', '').strip()
        start_time = request.form.get('start_time', '').strip()
        end_time = request.form.get('end_time', '').strip()
        # Fall back to 'time' field for backward compatibility
        if not start_time:
            start_time = request.form.get('time', '').strip()
        description = request.form.get('description', '').strip()
        
        # Get community_id and invited members
        community_id = request.form.get('community_id', type=int)
        invited_members = request.form.getlist('invited_members[]')
        invite_all = request.form.get('invite_all') == 'true'
        
        # Validate required fields
        if not title or not date:
            return jsonify({'success': False, 'message': 'Title and start date are required'})
        
        # Validate date format
        try:
            from datetime import datetime
            start_dt = datetime.strptime(date, '%Y-%m-%d')
        except ValueError:
            return jsonify({'success': False, 'message': 'Invalid start date format'})
        
        # Validate end date if provided
        if end_date:
            try:
                end_dt = datetime.strptime(end_date, '%Y-%m-%d')
                if end_dt < start_dt:
                    return jsonify({'success': False, 'message': 'End date cannot be before start date'})
            except ValueError:
                return jsonify({'success': False, 'message': 'Invalid end date format'})
        
        # Validate time formats if provided
        if start_time:
            try:
                datetime.strptime(start_time, '%H:%M')
            except ValueError:
                return jsonify({'success': False, 'message': 'Invalid start time format'})
        
        if end_time:
            try:
                datetime.strptime(end_time, '%H:%M')
                # Validate end_time is after start_time if both provided
                if start_time and end_time < start_time and date == end_date:
                    return jsonify({'success': False, 'message': 'End time cannot be before start time on the same day'})
            except ValueError:
                return jsonify({'success': False, 'message': 'Invalid end time format'})
        
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Insert the event (keeping 'time' field for backward compatibility)
            c.execute("""
                INSERT INTO calendar_events (username, title, date, end_date, time, start_time, end_time, description, created_at, community_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)
            """, (username, title, date, end_date if end_date else None, 
                  start_time if start_time else None,  # Keep time field for compatibility
                  start_time if start_time else None,  # start_time
                  end_time if end_time else None,      # end_time
                  description if description else None,
                  community_id))
            
            event_id = c.lastrowid
            
            # Handle invitations
            if community_id:
                invited_users = []
                
                if invite_all:
                    # Get all members of the community
                    c.execute("""
                        SELECT DISTINCT u.username 
                        FROM user_communities uc
                        JOIN users u ON uc.user_id = u.id
                        WHERE uc.community_id = ? AND u.username != ?
                    """, (community_id, username))
                    invited_users = [row['username'] for row in c.fetchall()]
                else:
                    # Use selected members
                    invited_users = invited_members
                
                # Insert invitations and create notifications
                for invited_user in invited_users:
                    try:
                        c.execute("""
                            INSERT INTO event_invitations (event_id, invited_username, invited_by, invited_at)
                            VALUES (?, ?, ?, ?)
                        """, (event_id, invited_user, username, datetime.now().isoformat()))
                        
                        # Create notification for the invited user
                        notification_message = f"{username} invited you to the event: {title}"
                        notification_link = f"/community/{community_id}/event/{event_id}/rsvp"
                        
                        c.execute("""
                            INSERT INTO notifications (user_id, from_user, message, created_at, is_read, link, type, community_id)
                            VALUES (?, ?, ?, ?, 0, ?, 'event_invitation', ?)
                        """, (invited_user, username, notification_message, datetime.now().isoformat(), notification_link, community_id))
                        
                    except sqlite3.IntegrityError:
                        # Skip if already invited
                        pass
            
            conn.commit()
            
            return jsonify({
                'success': True, 
                'message': f'Event added successfully. {len(invited_users) if community_id else 0} members invited.',
                'event_id': event_id
            })
            
    except Exception as e:
        logger.error(f"Error adding calendar event: {str(e)}")
        return jsonify({'success': False, 'message': str(e)})

@app.route('/get_links')
@login_required
def get_links():
    """Get all links for a community or main feed"""
    try:
        username = session['username']
        community_id = request.args.get('community_id')
        
        with get_db_connection() as conn:
            c = conn.cursor()
            
            if community_id:
                # Get links for specific community
                c.execute("""
                    SELECT id, username, url, description, created_at
                    FROM useful_links
                    WHERE community_id = ?
                    ORDER BY created_at DESC
                """, (community_id,))
            else:
                # Get links for main feed (community_id is NULL)
                c.execute("""
                    SELECT id, username, url, description, created_at
                    FROM useful_links
                    WHERE community_id IS NULL
                    ORDER BY created_at DESC
                """)
            
            links_raw = c.fetchall()
            links = []
            
            for link in links_raw:
                links.append({
                    'id': link['id'],
                    'username': link['username'],
                    'url': link['url'],
                    'description': link['description'],
                    'created_at': link['created_at'],
                    'can_delete': link['username'] == username or username == 'admin'
                })
            
            return jsonify({'success': True, 'links': links})
            
    except Exception as e:
        logger.error(f"Error getting links: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/add_link', methods=['POST'])
@login_required
def add_link():
    """Add a new useful link"""
    try:
        username = session['username']
        url = request.form.get('url', '').strip()
        description = request.form.get('description', '').strip()
        community_id = request.form.get('community_id')
        
        if not url or not description:
            return jsonify({'success': False, 'message': 'URL and description are required'})
        
        # Basic URL validation
        if not url.startswith(('http://', 'https://')):
            url = 'https://' + url
        
        with get_db_connection() as conn:
            c = conn.cursor()
            
            c.execute("""
                INSERT INTO useful_links (community_id, username, url, description, created_at)
                VALUES (?, ?, ?, ?, ?)
            """, (community_id if community_id else None, username, url, description, 
                  datetime.now().strftime('%Y-%m-%d %H:%M:%S')))
            
            conn.commit()
            
            return jsonify({'success': True, 'message': 'Link added successfully'})
            
    except Exception as e:
        logger.error(f"Error adding link: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/delete_link', methods=['POST'])
@login_required
def delete_link():
    """Delete a useful link"""
    try:
        username = session['username']
        link_id = request.form.get('link_id')
        
        if not link_id:
            return jsonify({'success': False, 'message': 'Link ID is required'})
        
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Check if user can delete (owner or admin)
            c.execute("SELECT username FROM useful_links WHERE id = ?", (link_id,))
            link = c.fetchone()
            
            if not link:
                return jsonify({'success': False, 'message': 'Link not found'})
            
            if link['username'] != username and username != 'admin':
                return jsonify({'success': False, 'message': 'You can only delete your own links'})
            
            # Delete the link
            c.execute("DELETE FROM useful_links WHERE id = ?", (link_id,))
            conn.commit()
            
            return jsonify({'success': True, 'message': 'Link deleted successfully'})
            
    except Exception as e:
        logger.error(f"Error deleting link: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/edit_calendar_event', methods=['POST'])
@login_required
def edit_calendar_event():
    """Edit a calendar event"""
    try:
        username = session.get('username')
        if not username:
            return jsonify({'success': False, 'message': 'User not logged in'})
        
        # Get event details from form
        event_id = request.form.get('event_id')
        title = request.form.get('title', '').strip()
        date = request.form.get('date', '').strip()
        end_date = request.form.get('end_date', '').strip()
        start_time = request.form.get('start_time', '').strip()
        end_time = request.form.get('end_time', '').strip()
        description = request.form.get('description', '').strip()
        
        if not all([event_id, title, date]):
            return jsonify({'success': False, 'message': 'Event ID, title, and date are required'})
        
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Get event details and community info
            c.execute("""
                SELECT e.username, e.community_id, c.creator_username
                FROM calendar_events e
                LEFT JOIN communities c ON e.community_id = c.id
                WHERE e.id = ?
            """, (event_id,))
            event = c.fetchone()
            
            if not event:
                return jsonify({'success': False, 'message': 'Event not found'})
            
            event_owner = event['username']
            community_id = event['community_id']
            community_owner = event['creator_username'] if event['creator_username'] else None
            
            # Check if user is community admin
            is_community_admin = False
            if community_id:
                c.execute("SELECT 1 FROM community_admins WHERE community_id = ? AND username = ?",
                         (community_id, username))
                is_community_admin = c.fetchone() is not None
            
            # Check permissions: user can edit if they're the event owner, app admin, community owner, or community admin
            can_edit = (
                event_owner == username or 
                username == 'admin' or 
                (community_owner and username == community_owner) or
                is_community_admin
            )
            
            if not can_edit:
                return jsonify({'success': False, 'message': 'You do not have permission to edit this event'})
            
            # Update the event
            c.execute("""
                UPDATE calendar_events 
                SET title = ?, date = ?, end_date = ?, start_time = ?, end_time = ?, 
                    time = ?, description = ?
                WHERE id = ?
            """, (title, date, end_date if end_date else None, 
                  start_time if start_time else None, end_time if end_time else None,
                  start_time if start_time else None,  # Keep time field for compatibility
                  description, event_id))
            
            conn.commit()
            
            return jsonify({'success': True, 'message': 'Event updated successfully'})
            
    except Exception as e:
        logger.error(f"Error editing calendar event: {str(e)}")
        return jsonify({'success': False, 'message': str(e)})

@app.route('/get_calendar_event/<int:event_id>')
@login_required
def get_calendar_event(event_id):
    """Get details of a specific calendar event for editing"""
    try:
        username = session.get('username')
        
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Get event details
            c.execute("""
                SELECT e.*, c.creator_username
                FROM calendar_events e
                LEFT JOIN communities c ON e.community_id = c.id
                WHERE e.id = ?
            """, (event_id,))
            
            event = c.fetchone()
            
            if not event:
                return jsonify({'success': False, 'message': 'Event not found'})
            
            # Check if user is community admin
            is_community_admin = False
            if event['community_id']:
                c.execute("SELECT 1 FROM community_admins WHERE community_id = ? AND username = ?",
                         (event['community_id'], username))
                is_community_admin = c.fetchone() is not None
            
            # Check if user can edit
            can_edit = (
                event['username'] == username or 
                username == 'admin' or 
                (event['creator_username'] and username == event['creator_username']) or
                is_community_admin
            )
            
            return jsonify({
                'success': True,
                'event': {
                    'id': event['id'],
                    'title': event['title'],
                    'date': event['date'],
                    'end_date': event['end_date'],
                    'start_time': event['start_time'] or event['time'],
                    'end_time': event['end_time'],
                    'description': event['description'],
                    'username': event['username'],
                    'can_edit': can_edit
                }
            })
            
    except Exception as e:
        logger.error(f"Error getting calendar event: {str(e)}")
        return jsonify({'success': False, 'message': str(e)})
@app.route('/test_color_detection')
def test_color_detection():
    """Test page for color detection"""
    return '''
    <!DOCTYPE html>
    <html>
    <head>
        <title>Color Detection Test</title>
        <style>
            body { font-family: Arial; padding: 20px; background: #f0f0f0; }
            .container { max-width: 800px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; }
            input { width: 100%; padding: 10px; margin: 10px 0; }
            button { padding: 10px 20px; background: #4CAF50; color: white; border: none; cursor: pointer; }
            #result { margin-top: 20px; padding: 20px; background: #f9f9f9; border-radius: 4px; }
            #preview { max-width: 300px; margin: 20px 0; }
            #colorBox { width: 100px; height: 100px; border: 2px solid #333; margin: 10px 0; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>Image Color Detection Test</h1>
            <input type="text" id="imageUrl" placeholder="Enter image URL" value="">
            <button onclick="testColor()">Test Color Detection</button>
            <div id="result"></div>
            <img id="preview" style="display:none;">
            <div id="colorBox" style="display:none;"></div>
        </div>
        <script>
            function testColor() {
                const url = document.getElementById('imageUrl').value;
                if (!url) {
                    alert('Please enter an image URL');
                    return;
                }
                
                // Show preview
                const preview = document.getElementById('preview');
                preview.src = url;
                preview.style.display = 'block';
                
                // Fetch color
                fetch(`/get_image_color?url=${encodeURIComponent(url)}`)
                    .then(response => response.json())
                    .then(data => {
                        console.log('Full response:', data);
                        
                        let html = '<h3>Detection Results:</h3>';
                        if (data.success) {
                            const color = data.color;
                            const rgbStr = `rgb(${color.r}, ${color.g}, ${color.b})`;
                            
                            html += `<p><strong>Detected Background Color:</strong> ${rgbStr}</p>`;
                            
                            // Show color box
                            const colorBox = document.getElementById('colorBox');
                            colorBox.style.backgroundColor = rgbStr;
                            colorBox.style.display = 'block';
                            
                            if (data.debug) {
                                html += '<h4>Debug Info:</h4>';
                                html += `<p><strong>Corner Colors:</strong><br>${data.debug.corner_colors.join('<br>')}</p>`;
                                html += `<p><strong>Top Colors Overall:</strong><br>${data.debug.top_colors.join('<br>')}</p>`;
                            }
                        } else {
                            html += '<p>Color detection failed</p>';
                        }
                        
                        document.getElementById('result').innerHTML = html;
                    })
                    .catch(error => {
                        document.getElementById('result').innerHTML = `<p>Error: ${error}</p>`;
                    });
            }
        </script>
    </body>
    </html>
    '''
@app.route('/get_image_color')
def get_image_color():
    """Extract background color from an image URL using simple border detection"""
    try:
        import requests
        from PIL import Image
        from io import BytesIO
        from collections import Counter
        
        image_url = request.args.get('url')
        if not image_url:
            return jsonify({'success': False, 'message': 'No URL provided'})
        
        try:
            # Download the image
            response = requests.get(image_url, timeout=10)
            response.raise_for_status()
            
            # Open image and convert to RGB
            img = Image.open(BytesIO(response.content)).convert('RGB')
            
            # Get dimensions
            width, height = img.size
            
            # Collect border pixels
            border_pixels = []
            
            # Top border
            for x in range(width):
                border_pixels.append(img.getpixel((x, 0)))
            
            # Bottom border
            for x in range(width):
                border_pixels.append(img.getpixel((x, height - 1)))
            
            # Left border (excluding corners to avoid double counting)
            for y in range(1, height - 1):
                border_pixels.append(img.getpixel((0, y)))
            
            # Right border (excluding corners to avoid double counting)
            for y in range(1, height - 1):
                border_pixels.append(img.getpixel((width - 1, y)))
            
            # Find the most common color in the borders
            color_counts = Counter(border_pixels)
            most_common_color = color_counts.most_common(1)[0][0]
            
            # Get top 5 colors for debugging
            top_colors = color_counts.most_common(5)
            total_border_pixels = len(border_pixels)
            
            # Log for debugging
            logger.info(f"Image URL: {image_url}")
            logger.info(f"Image size: {width}x{height}")
            logger.info(f"Background color (most common border): RGB{most_common_color}")
            logger.info(f"Top 5 border colors: {[(color, count) for color, count in top_colors]}")
            
            return jsonify({
                'success': True,
                'color': {
                    'r': most_common_color[0],
                    'g': most_common_color[1],
                    'b': most_common_color[2]
                },
                'debug': {
                    'url': image_url,
                    'detected': f"rgb({most_common_color[0]}, {most_common_color[1]}, {most_common_color[2]})",
                    'image_size': f"{width}x{height}",
                    'border_pixels_analyzed': total_border_pixels,
                    'top_border_colors': [
                        f"rgb{color} ({count} pixels, {(count/total_border_pixels)*100:.1f}%)" 
                        for color, count in top_colors
                    ],
                    'method': 'Simple border pixel detection'
                }
            })
            
        except Exception as e:
            logger.error(f"Error processing image: {str(e)}")
            # Return white as fallback
            return jsonify({
                'success': True,
                'color': {'r': 255, 'g': 255, 'b': 255}
            })
            
    except Exception as e:
        logger.error(f"Error in get_image_color: {str(e)}")
        return jsonify({
            'success': True,
            'color': {'r': 255, 'g': 255, 'b': 255}
        })

@app.route('/get_event_rsvp_details')
@login_required
def get_event_rsvp_details():
    """Get detailed RSVP information including non-responders"""
    try:
        event_id = request.args.get('event_id', type=int)
        if not event_id:
            return jsonify({'success': False, 'message': 'Event ID required'}), 400
            
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Get all RSVPs for the event
            c.execute("""
                SELECT r.username, r.response, u.username as display_name
                FROM event_rsvps r
                JOIN users u ON r.username = u.username
                WHERE r.event_id = ?
                ORDER BY r.response, u.username
            """, (event_id,))
            
            rsvps = c.fetchall()
            
            # Get all invited users
            c.execute("""
                SELECT i.invited_username, u.username as display_name
                FROM event_invitations i
                JOIN users u ON i.invited_username = u.username
                WHERE i.event_id = ?
                ORDER BY u.username
            """, (event_id,))
            
            invited_users = c.fetchall()
            
            # Organize attendees by response
            attendees = {
                'going': [],
                'maybe': [],
                'not_going': [],
                'no_response': []
            }
            
            # Track who has responded
            responded_users = set()
            
            # Categorize RSVPs
            for rsvp in rsvps:
                user_info = {
                    'username': rsvp['display_name'] or rsvp['username']
                }
                attendees[rsvp['response']].append(user_info)
                responded_users.add(rsvp['username'])
            
            # Find non-responders from invited users
            for invitation in invited_users:
                if invitation['invited_username'] not in responded_users:
                    attendees['no_response'].append({
                        'username': invitation['display_name'] or invitation['invited_username']
                    })
            
            # If no specific invitations, check if it was an "invite all" event
            if not invited_users:
                c.execute("""
                    SELECT e.*, c.id as community_id
                    FROM calendar_events e
                    LEFT JOIN communities c ON e.community_id = c.id
                    WHERE e.id = ?
                """, (event_id,))
                
                event = c.fetchone()
                
                # If it's a community event, get all community members who haven't responded
                if event and event['community_id']:
                    c.execute("""
                        SELECT u.username
                        FROM user_communities uc
                        JOIN users u ON uc.user_id = u.id
                        WHERE uc.community_id = ?
                        AND u.username NOT IN (
                            SELECT username FROM event_rsvps WHERE event_id = ?
                        )
                        ORDER BY u.username
                    """, (event['community_id'], event_id))
                    
                    non_responders = c.fetchall()
                    for user in non_responders:
                        attendees['no_response'].append({
                            'username': user['username']
                        })
            
            return jsonify({
                'success': True,
                'attendees': attendees,
                'total_invited': len(invited_users) if invited_users else len(attendees['no_response']) + len(responded_users),
                'total_responded': len(responded_users)
            })
            
    except Exception as e:
        logger.error(f"Error getting RSVP details: {str(e)}")
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/delete_calendar_event', methods=['POST'])
@login_required
def delete_calendar_event():
    """Delete a calendar event"""
    try:
        username = session.get('username')
        if not username:
            return jsonify({'success': False, 'message': 'User not logged in'})
            
        event_id = request.form.get('event_id', type=int)
        
        logger.info(f"Delete request from {username} for event ID: {event_id}")
        
        if not event_id:
            return jsonify({'success': False, 'message': 'Event ID is required'})
        
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Get event details and community info
            c.execute("""
                SELECT e.username, e.community_id, c.creator_username
                FROM calendar_events e
                LEFT JOIN communities c ON e.community_id = c.id
                WHERE e.id = ?
            """, (event_id,))
            event = c.fetchone()
            
            if not event:
                logger.warning(f"Event {event_id} not found")
                return jsonify({'success': False, 'message': 'Event not found'})
            
            event_owner = event['username']
            community_id = event['community_id']
            community_owner = event['creator_username'] if event['creator_username'] else None
            
            # Check if user is community admin
            is_community_admin = False
            if community_id:
                c.execute("SELECT 1 FROM community_admins WHERE community_id = ? AND username = ?",
                         (community_id, username))
                is_community_admin = c.fetchone() is not None
            
            # Check permissions: user can delete if they're the event owner, app admin, community owner, or community admin
            can_delete = (
                event_owner == username or 
                username == 'admin' or 
                (community_owner and username == community_owner) or
                is_community_admin
            )
            
            if not can_delete:
                logger.warning(f"User {username} tried to delete event owned by {event_owner}")
                return jsonify({'success': False, 'message': 'You do not have permission to delete this event'})
            
            # Delete the event
            c.execute("DELETE FROM calendar_events WHERE id = ?", (event_id,))
            deleted_count = c.rowcount
            conn.commit()
            
            if deleted_count > 0:
                logger.info(f"Successfully deleted event {event_id}")
                return jsonify({'success': True, 'message': 'Event deleted successfully'})
            else:
                return jsonify({'success': False, 'message': 'Event could not be deleted'})
            
    except Exception as e:
        logger.error(f"Error deleting calendar event: {str(e)}", exc_info=True)
        return jsonify({'success': False, 'message': f'Server error: {str(e)}'})

@app.route('/delete_post', methods=['POST'])
@login_required
def delete_post():
    username = session['username']
    # Temporarily disable CSRF validation
    # if not validate_csrf():
    #     return jsonify({'success': False, 'error': 'Invalid CSRF token'}), 400
    post_id = request.form.get('post_id', type=int)
    logger.debug(f"Received delete post request for {username} with post_id: {post_id}")
    if not post_id:
        return jsonify({'success': False, 'error': 'Post ID is required!'}), 400
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT username, image_path FROM posts WHERE id= ?", (post_id,))
            post = c.fetchone()
            if not post or (post['username'] != username and username != 'admin'):
                return jsonify({'success': False, 'error': 'Post not found or unauthorized!'}), 403
            
            # Delete image file if it exists
            if post['image_path']:
                try:
                    image_file_path = os.path.join('static', post['image_path'])
                    if os.path.exists(image_file_path):
                        os.remove(image_file_path)
                except Exception as e:
                    logger.warning(f"Could not delete image file {post['image_path']}: {e}")
            
            c.execute("DELETE FROM replies WHERE post_id= ?", (post_id,))
            c.execute("DELETE FROM posts WHERE id= ?", (post_id,))
            conn.commit()
        logger.info(f"Post {post_id} deleted successfully by {username}")
        return jsonify({'success': True, 'message': 'Post deleted!'}), 200
    except Exception as e:
        logger.error(f"Error deleting post {post_id} for {username}: {str(e)}", exc_info=True)
        return jsonify({'success': False, 'error': f'Unexpected error: {str(e)}'}), 500

@app.route('/edit_post', methods=['POST'])
@login_required
def edit_post():
    """Edit a post's content (owner or admin)."""
    username = session['username']
    post_id = request.form.get('post_id', type=int)
    new_content = (request.form.get('content') or '').strip()
    if not post_id or not new_content:
        return jsonify({'success': False, 'error': 'Post ID and content are required!'}), 400
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT username FROM posts WHERE id = ?", (post_id,))
            row = c.fetchone()
            if not row:
                return jsonify({'success': False, 'error': 'Post not found!'}), 404
            owner = row['username'] if hasattr(row, 'keys') else row[0]
            if owner != username and username != 'admin':
                return jsonify({'success': False, 'error': 'Unauthorized!'}), 403
            c.execute("UPDATE posts SET content = ?, timestamp = ? WHERE id = ?", (new_content, datetime.now().strftime('%Y-%m-%d %H:%M:%S'), post_id))
            conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Error editing post {post_id} by {username}: {e}")
        return jsonify({'success': False, 'error': 'Server error'}), 500

@app.route('/delete_reply', methods=['POST'])
@login_required
def delete_reply():
    username = session['username']
    # Temporarily disable CSRF validation
    # if not validate_csrf():
    #     return jsonify({'success': False, 'error': 'Invalid CSRF token'}), 400
    reply_id = request.form.get('reply_id', type=int)
    logger.debug(f"Received delete reply request for {username} with reply_id: {reply_id}")
    if not reply_id:
        return jsonify({'success': False, 'error': 'Reply ID is required!'}), 400
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT username, image_path FROM replies WHERE id= ?", (reply_id,))
            reply = c.fetchone()
            if not reply or (reply['username'] != username and username != 'admin'):
                return jsonify({'success': False, 'error': 'Reply not found or unauthorized!'}), 403
            
            # Delete image file if it exists
            if reply['image_path']:
                try:
                    image_file_path = os.path.join('static', reply['image_path'])
                    if os.path.exists(image_file_path):
                        os.remove(image_file_path)
                except Exception as e:
                    logger.warning(f"Could not delete reply image file {reply['image_path']}: {e}")
            
            c.execute("DELETE FROM replies WHERE id= ?", (reply_id,))
            conn.commit()
        logger.info(f"Reply {reply_id} deleted successfully by {username}")
        return jsonify({'success': True, 'message': 'Reply deleted!'}), 200
    except Exception as e:
        logger.error(f"Error deleting reply {reply_id} for {username}: {str(e)}", exc_info=True)
        return jsonify({'success': False, 'error': f'Unexpected error: {str(e)}'}), 500

@app.route('/add_reply_reaction', methods=['POST'])
@login_required
def add_reply_reaction():
    username = session['username']
    # Temporarily disable CSRF validation
    # if not validate_csrf():
    #     return jsonify({'success': False, 'error': 'Invalid CSRF token'}), 400
    reply_id = request.form.get('reply_id', type=int)
    reaction_type = request.form.get('reaction')

    if not all([reply_id, reaction_type]):
        return jsonify({'success': False, 'error': 'Missing data'}), 400

    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT id, reaction_type FROM reply_reactions WHERE reply_id = ? AND username = ?", (reply_id, username))
            existing = c.fetchone()
            if existing:
                if existing['reaction_type'] == reaction_type:
                    c.execute("DELETE FROM reply_reactions WHERE id = ?", (existing['id'],))
                else:
                    c.execute("UPDATE reply_reactions SET reaction_type = ? WHERE id = ?", (reaction_type, existing['id']))
            else:
                c.execute("INSERT INTO reply_reactions (reply_id, username, reaction_type) VALUES (?, ?, ?)", (reply_id, username, reaction_type))
            conn.commit()
            c.execute("""
                SELECT reaction_type, COUNT(*) as count
                FROM reply_reactions
                WHERE reply_id = ?
                GROUP BY reaction_type
            """, (reply_id,))
            counts_raw = c.fetchall()
            new_counts = {r['reaction_type']: r['count'] for r in counts_raw}
            c.execute("SELECT reaction_type FROM reply_reactions WHERE reply_id = ? AND username = ?", (reply_id, username))
            user_reaction_raw = c.fetchone()
            new_user_reaction = user_reaction_raw['reaction_type'] if user_reaction_raw else None
            return jsonify({'success': True, 'counts': new_counts, 'user_reaction': new_user_reaction})
    except Exception as e:
        logger.error(f"Error adding reply reaction: {str(e)}")
        return jsonify({'success': False, 'error': 'Server error'}), 500

@app.route('/get_post')
@login_required
def get_post():
    username = session.get('username')
    post_id = request.args.get('post_id', type=int)
    
    if not post_id:
        return jsonify({'success': False, 'error': 'Post ID is required'}), 400
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Fetch the post
            c.execute("SELECT * FROM posts WHERE id = ?", (post_id,))
            post_raw = c.fetchone()
            
            if not post_raw:
                return jsonify({'success': False, 'error': 'Post not found'}), 404
            
            post = dict(post_raw)
            # Attach profile picture for post author
            try:
                c.execute("SELECT profile_picture FROM user_profiles WHERE username = ?", (post['username'],))
                pp = c.fetchone()
                post['profile_picture'] = pp['profile_picture'] if pp and 'profile_picture' in pp.keys() else None
            except Exception:
                post['profile_picture'] = None
            
            # Fetch replies for the post (top-level first)
            c.execute("SELECT * FROM replies WHERE post_id = ? ORDER BY timestamp DESC", (post_id,))
            replies_raw = [dict(row) for row in c.fetchall()]
            # Build nested tree by parent_reply_id
            children_map = {}
            for r in replies_raw:
                pid = r.get('parent_reply_id')
                children_map.setdefault(pid, []).append(r)
            def build_tree(parent_id=None):
                arr = []
                for r in children_map.get(parent_id, []):
                    r['children'] = build_tree(r['id'])
                    arr.append(r)
                return arr
            post['replies'] = build_tree(None)
            
            # Fetch reactions for the post
            c.execute("""
                SELECT reaction_type, COUNT(*) as count
                FROM reactions
                WHERE post_id = ?
                GROUP BY reaction_type
            """, (post_id,))
            reactions_raw = c.fetchall()
            post['reactions'] = {r['reaction_type']: r['count'] for r in reactions_raw}
            
            # Get the current user's reaction to this post
            c.execute("SELECT reaction_type FROM reactions WHERE post_id = ? AND username = ?", (post_id, username))
            user_reaction_raw = c.fetchone()
            post['user_reaction'] = user_reaction_raw['reaction_type'] if user_reaction_raw else None
            
            # Add reaction counts for each reply and user reaction
            def hydrate_reply_metrics(reply):
                # Attach profile picture per reply
                try:
                    c.execute("SELECT profile_picture FROM user_profiles WHERE username = ?", (reply['username'],))
                    pr = c.fetchone()
                    reply['profile_picture'] = pr['profile_picture'] if pr and 'profile_picture' in pr.keys() else None
                except Exception:
                    reply['profile_picture'] = None
                c.execute("""
                    SELECT reaction_type, COUNT(*) as count
                    FROM reply_reactions
                    WHERE reply_id = ?
                    GROUP BY reaction_type
                """, (reply['id'],))
                rr = c.fetchall()
                reply['reactions'] = {r['reaction_type']: r['count'] for r in rr}
                c.execute("SELECT reaction_type FROM reply_reactions WHERE reply_id = ? AND username = ?", (reply['id'], username))
                ur = c.fetchone()
                reply['user_reaction'] = ur['reaction_type'] if ur else None
                for ch in reply.get('children', []):
                    hydrate_reply_metrics(ch)
            for reply in post['replies']:
                hydrate_reply_metrics(reply)
            
            return jsonify({'success': True, 'post': post})
            
    except Exception as e:
        logger.error(f"Error fetching post {post_id}: {str(e)}")
        return jsonify({'success': False, 'error': 'Server error'}), 500

# Community Routes
@app.route('/communities')
@login_required
def communities():
    """Main communities page"""
    username = session['username']
    try:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        dist_dir = os.path.join(base_dir, 'client', 'dist')
        return send_from_directory(dist_dir, 'index.html')
    except Exception as e:
        logger.error(f"Error in communities for {username}: {str(e)}")
        abort(500)

@app.route('/create_community', methods=['POST'])
@login_required
def create_community():
    """Create a new community"""
    username = session.get('username')
    name = request.form.get('name')
    community_type = request.form.get('type')
    description = request.form.get('description', '')
    location = request.form.get('location', '')
    template = request.form.get('template', 'default')
    background_color = request.form.get('background_color', '#2d3839')
    text_color = request.form.get('text_color', '#ffffff')
    accent_color = request.form.get('accent_color', '#4db6ac')
    card_color = request.form.get('card_color', '#1a2526')
    parent_community_id = request.form.get('parent_community_id', None)
    
    if not name or not community_type:
        return jsonify({'success': False, 'error': 'Name and type are required'}), 400
    
    # Handle background image
    background_path = None
    if 'background_file' in request.files:
        file = request.files['background_file']
        if file.filename != '':
            background_path = save_uploaded_file(file, 'community_backgrounds')
            if not background_path:
                return jsonify({'success': False, 'error': 'Invalid background image file type. Allowed: png, jpg, jpeg, gif, webp'}), 400
    
    # Use URL if no file uploaded
    if not background_path:
        background_url = request.form.get('background_url', '').strip()
        if background_url:
            background_path = background_url
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Generate unique join code
            join_code = generate_join_code()
            
            # Create the community (support types like 'gym', 'crossfit', etc.)
            c.execute("""
                INSERT INTO communities (name, type, creator_username, join_code, created_at, description, location, background_path, template, background_color, text_color, accent_color, card_color, parent_community_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (name, community_type, username, join_code, datetime.now().strftime('%m.%d.%y %H:%M'), description, location, background_path, template, background_color, text_color, accent_color, card_color, parent_community_id if parent_community_id and parent_community_id != 'none' else None))
            
            community_id = c.lastrowid
            
            # Get user's ID and add creator as member
            c.execute("SELECT id FROM users WHERE username = ?", (username,))
            user_row = c.fetchone()
            if user_row:
                user_id = user_row[0] if not hasattr(user_row, 'keys') else user_row['id']
                c.execute("""
                    INSERT INTO user_communities (user_id, community_id, joined_at)
                    VALUES (?, ?, ?)
                """, (user_id, community_id, datetime.now().strftime('%m.%d.%y %H:%M')))
            
            # Ensure admin is also a member of every community
            c.execute("SELECT id FROM users WHERE username = 'admin'")
            admin_row = c.fetchone()
            if admin_row:
                admin_id = admin_row[0]
                c.execute("SELECT 1 FROM user_communities WHERE user_id=? AND community_id=?", (admin_id, community_id))
                if not c.fetchone():
                    c.execute("""
                        INSERT INTO user_communities (user_id, community_id, joined_at)
                        VALUES (?, ?, ?)
                    """, (admin_id, community_id, datetime.now().strftime('%m.%d.%y %H:%M')))
            
            conn.commit()
            
            return jsonify({
                'success': True, 
                'community_id': community_id,
                'join_code': join_code,
                'message': f'Community "{name}" created successfully!'
            })
            
    except Exception as e:
        logger.error(f"Error creating community: {str(e)}")
        return jsonify({'success': False, 'error': 'Failed to create community'}), 500
@app.route('/get_available_parent_communities', methods=['GET'])
@login_required
def get_available_parent_communities():
    """Get communities that can be parent communities (excluding the current one if editing)"""
    username = session.get('username')
    current_community_id = request.args.get('current_id', type=int)
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Get all communities that the user has access to or created
            # Exclude the current community and its children to prevent circular references
            if current_community_id:
                c.execute("""
                    SELECT DISTINCT c.id, c.name, c.type, c.parent_community_id
                    FROM communities c
                    LEFT JOIN user_communities uc ON c.id = uc.community_id
                    LEFT JOIN users u ON uc.user_id = u.id
                    WHERE (u.username = ? OR c.creator_username = ? OR ? = 'admin')
                    AND c.id != ?
                    AND (c.parent_community_id IS NULL OR c.parent_community_id != ?)
                    ORDER BY c.name
                """, (username, username, username, current_community_id, current_community_id))
            else:
                c.execute("""
                    SELECT DISTINCT c.id, c.name, c.type, c.parent_community_id
                    FROM communities c
                    LEFT JOIN user_communities uc ON c.id = uc.community_id
                    LEFT JOIN users u ON uc.user_id = u.id
                    WHERE u.username = ? OR c.creator_username = ? OR ? = 'admin'
                    ORDER BY c.name
                """, (username, username, username))
            
            communities = []
            for row in c.fetchall():
                communities.append({
                    'id': row['id'],
                    'name': row['name'],
                    'type': row['type'],
                    'parent_community_id': row['parent_community_id']
                })
            
            return jsonify({'success': True, 'communities': communities})
            
    except Exception as e:
        logger.error(f"Error getting parent communities: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/get_user_communities_with_members', methods=['GET'])
@login_required
def get_user_communities_with_members():
    """Get user's communities with member lists"""
    username = session.get('username')
    logger.info(f"Getting communities for user: {username}")
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Get user ID
            c.execute("SELECT id FROM users WHERE username = ?", (username,))
            user = c.fetchone()
            if not user:
                logger.error(f"User not found: {username}")
                return jsonify({'success': False, 'error': 'User not found'})
            
            user_id = user['id'] if hasattr(user, 'keys') else user[0]
            logger.info(f"User ID: {user_id}")
            
            # Get communities the user belongs to
            c.execute("""
                SELECT c.id, c.name, c.type, c.creator_username
                FROM communities c
                JOIN user_communities uc ON c.id = uc.community_id
                WHERE uc.user_id = ?
                ORDER BY c.name
            """, (user_id,))
            
            communities = c.fetchall()
            logger.info(f"Found {len(communities)} communities for user {username}")
            
            result = []
            for community in communities:
                try:
                    # Get members of each community with profile pictures
                    c.execute("""
                        SELECT u.id as id, u.username, p.profile_picture
                        FROM users u
                        JOIN user_communities uc ON u.id = uc.user_id
                        LEFT JOIN user_profiles p ON u.username = p.username
                        WHERE uc.community_id = ? AND u.username != ?
                        ORDER BY u.username
                    """, (community['id'], username))
                    
                    members = []
                    for member in c.fetchall():
                        members.append({
                            'id': member['id'],
                            'username': member['username'],
                            'profile_pic': member['profile_picture'] if member['profile_picture'] else None,
                            'online': False  # You can implement online status tracking later
                        })
                    
                    logger.info(f"Community {community['name']} has {len(members)} members")
                    
                    result.append({
                        'id': community['id'],
                        'name': community['name'],
                        'type': community['type'],
                        'is_creator': community['creator_username'] == username,
                        'members': members
                    })
                except Exception as ce:
                    logger.error(f"Error processing community {community['name'] if 'name' in community else 'unknown'}: {str(ce)}")
                    continue
            
            logger.info(f"Returning {len(result)} communities with members")
            return jsonify({'success': True, 'communities': result})
            
    except Exception as e:
        logger.error(f"Error fetching communities with members: {str(e)}")
        logger.error(f"Exception type: {type(e).__name__}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        return jsonify({'success': False, 'error': f'Failed to fetch communities: {str(e)}'})

@app.route('/get_user_communities')
@login_required
def get_user_communities():
    """Get all communities the user is a member of"""
    username = session.get('username')
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Get user's communities with creator information and active status
            c.execute("""
                SELECT c.id, c.name, c.type, c.join_code, c.created_at, c.creator_username, c.is_active
                FROM communities c
                JOIN user_communities uc ON c.id = uc.community_id
                JOIN users u ON uc.user_id = u.id
                WHERE u.username = ?
                ORDER BY c.created_at DESC
            """, (username,))
            
            communities = []
            for row in c.fetchall():
                communities.append({
                    'id': row['id'],
                    'name': row['name'],
                    'type': row['type'],
                    'join_code': row['join_code'],
                    'created_at': row['created_at'],
                    'is_creator': row['creator_username'] == username,
                    'is_active': row['is_active'] if row['is_active'] is not None else True
                })
            
            return jsonify({'success': True, 'communities': communities})
            
    except Exception as e:
        logger.error(f"Error fetching user communities: {str(e)}")
        return jsonify({'success': False, 'error': 'Failed to fetch communities'}), 500

@app.route('/edit_community', methods=['POST'])
@login_required
def edit_community():
    """Edit a community name"""
    username = session.get('username')
    community_id = request.form.get('community_id', type=int)
    new_name = request.form.get('name', '').strip()
    
    if not community_id or not new_name:
        return jsonify({'success': False, 'error': 'Community ID and name are required'}), 400
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Check if user is the creator of this community
            c.execute("SELECT creator_username FROM communities WHERE id = ?", (community_id,))
            community = c.fetchone()
            
            if not community:
                return jsonify({'success': False, 'error': 'Community not found'}), 404
            
            if community['creator_username'] != username:
                return jsonify({'success': False, 'error': 'Only the community creator can edit the community'}), 403
            
            # Update the community name
            c.execute("UPDATE communities SET name = ? WHERE id = ?", (new_name, community_id))
            conn.commit()
            
            return jsonify({'success': True, 'message': 'Community updated successfully'})
            
    except Exception as e:
        logger.error(f"Error editing community: {str(e)}")
        return jsonify({'success': False, 'error': 'Failed to edit community'}), 500
@app.route('/update_community', methods=['POST'])
@login_required
def update_community():
    """Update community details (name, description, type, background, template, colors, parent)"""
    username = session.get('username')
    community_id = request.form.get('community_id', type=int)
    name = request.form.get('name', '').strip()
    description = request.form.get('description', '').strip()
    community_type = request.form.get('type', '').strip()
    template = request.form.get('template', 'dark')
    background_color = request.form.get('background_color', '#2d3839')
    card_color = request.form.get('card_color', '#1a2526')
    accent_color = request.form.get('accent_color', '#4db6ac')
    text_color = request.form.get('text_color', '#ffffff')
    parent_community_id = request.form.get('parent_community_id', None)
    
    if not community_id or not name:
        return jsonify({'success': False, 'error': 'Community ID and name are required'}), 400
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Check if user is the creator of this community or admin
            c.execute("SELECT creator_username FROM communities WHERE id = ?", (community_id,))
            community = c.fetchone()
            
            if not community:
                return jsonify({'success': False, 'error': 'Community not found'}), 404
            
            if community['creator_username'] != username and username != 'admin':
                return jsonify({'success': False, 'error': 'Only the community creator or admin can edit the community'}), 403
            
            # Handle background file upload
            background_path = None
            if 'background_file' in request.files:
                file = request.files['background_file']
                if file and file.filename:
                    # Save the uploaded file
                    filename = secure_filename(file.filename)
                    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
                    name_part, ext = os.path.splitext(filename)
                    unique_filename = f"{name_part}_{timestamp}{ext}"
                    
                    # Create community_backgrounds directory if it doesn't exist
                    upload_path = os.path.join(app.config['UPLOAD_FOLDER'], 'community_backgrounds')
                    os.makedirs(upload_path, exist_ok=True)
                    
                    filepath = os.path.join(upload_path, unique_filename)
                    file.save(filepath)
                    background_path = f"community_backgrounds/{unique_filename}"
            
            # Update the community details
            if background_path:
                c.execute("""UPDATE communities 
                            SET name = ?, description = ?, type = ?, background_path = ?, template = ?, 
                                background_color = ?, card_color = ?, accent_color = ?, text_color = ?, parent_community_id = ? 
                            WHERE id = ?""", 
                         (name, description, community_type, background_path, template, 
                          background_color, card_color, accent_color, text_color, 
                          parent_community_id if parent_community_id and parent_community_id != 'none' else None, 
                          community_id))
            else:
                c.execute("""UPDATE communities 
                            SET name = ?, description = ?, type = ?, template = ?, 
                                background_color = ?, card_color = ?, accent_color = ?, text_color = ?, parent_community_id = ? 
                            WHERE id = ?""", 
                         (name, description, community_type, template, 
                          background_color, card_color, accent_color, text_color, 
                          parent_community_id if parent_community_id and parent_community_id != 'none' else None, 
                          community_id))
            
            conn.commit()
            
            return jsonify({'success': True, 'message': 'Community updated successfully'})
            
    except Exception as e:
        logger.error(f"Error updating community: {str(e)}")
        return jsonify({'success': False, 'error': 'Failed to update community'}), 500

@app.route('/delete_community', methods=['POST'])
@login_required
def delete_community():
    """Delete a community and all its posts"""
    username = session.get('username')
    community_id = request.form.get('community_id', type=int)
    
    if not community_id:
        return jsonify({'success': False, 'error': 'Community ID is required'}), 400
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Check if user is the creator of this community
            c.execute("SELECT creator_username FROM communities WHERE id = ?", (community_id,))
            community = c.fetchone()
            
            if not community:
                return jsonify({'success': False, 'error': 'Community not found'}), 404
            
            if community['creator_username'] != username:
                return jsonify({'success': False, 'error': 'Only the community creator can delete the community'}), 403
            
            # Delete all posts in the community
            c.execute("DELETE FROM posts WHERE community_id = ?", (community_id,))
            
            # Delete all user_communities entries for this community
            c.execute("DELETE FROM user_communities WHERE community_id = ?", (community_id,))
            
            # Delete the community itself
            c.execute("DELETE FROM communities WHERE id = ?", (community_id,))
            
            conn.commit()
            
            return jsonify({'success': True, 'message': 'Community deleted successfully'})
            
    except Exception as e:
        logger.error(f"Error deleting community: {str(e)}")
        return jsonify({'success': False, 'error': 'Failed to delete community'}), 500

@app.route('/migrate_database')
def migrate_database():
    """Manual database migration endpoint"""
    try:
        add_missing_tables()
        return jsonify({'success': True, 'message': 'Database migration completed successfully'})
    except Exception as e:
        logger.error(f"Database migration failed: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/debug_community/<int:community_id>')
@login_required
def debug_community(community_id):
    """Debug route to check community data"""
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Get community info
            c.execute("SELECT * FROM communities WHERE id = ?", (community_id,))
            community = c.fetchone()
            
            if not community:
                return jsonify({'success': False, 'error': 'Community not found'})
            
            community_dict = dict(community)
            logger.info(f"Debug community {community_id}: {community_dict}")
            
            return jsonify({
                'success': True,
                'community': community_dict,
                'community_id_type': type(community_dict.get('id')),
                'community_id_value': community_dict.get('id')
            })
    except Exception as e:
        logger.error(f"Error in debug_community: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/debug_posts')
@login_required
def debug_posts():
    """Debug route to check posts in database"""
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Check posts table structure
            c.execute("SHOW COLUMNS FROM posts")
            columns = c.fetchall()
            logger.info("Posts table structure:")
            for col in columns:
                logger.info(f"  {col['Field']}: {col['Type']}")
            
            # Get all posts
            c.execute("SELECT id, username, content, community_id FROM posts ORDER BY id DESC LIMIT 10")
            posts = c.fetchall()
            logger.info(f"Recent posts in database:")
            for post in posts:
                logger.info(f"  Post {post['id']}: {post['username']} - {post['content'][:50]}... (community_id: {post['community_id']})")
            
            return jsonify({
                'success': True,
                'posts': [dict(post) for post in posts],
                'columns': [dict(col) for col in columns]
            })
    except Exception as e:
        logger.error(f"Error in debug_posts: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/join_community', methods=['POST'])
@login_required
def join_community():
    """Join a community using a community code"""
    username = session.get('username')
    community_code = request.form.get('community_code', '').strip()
    
    logger.info(f"Join community request from {username} with code: {community_code}")
    
    if not community_code:
        return jsonify({'success': False, 'error': 'Community code is required'})
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Get user ID
            c.execute("SELECT id FROM users WHERE username = ?", (username,))
            user = c.fetchone()
            if not user:
                return jsonify({'success': False, 'error': 'User not found'})
            
            user_id = user['id'] if hasattr(user, 'keys') else user[0]
            
            # Find community by join code
            c.execute("""
                SELECT id, name, join_code FROM communities 
                WHERE join_code = ?
            """, (community_code,))
            
            community = c.fetchone()
            logger.info(f"Community lookup result: {community}")
            if not community:
                return jsonify({'success': False, 'error': 'Invalid community code'})
            
            community_id = community['id']
            community_name = community['name']
            
            # Get community type
            c.execute("SELECT type FROM communities WHERE id = ?", (community_id,))
            community_type_result = c.fetchone()
            community_type = community_type_result['type'] if community_type_result else 'public'
            
            # Check if user is already a member
            c.execute("""
                SELECT id FROM user_communities 
                WHERE user_id = ? AND community_id = ?
            """, (user_id, community_id))
            
            existing_membership = c.fetchone()
            if existing_membership:
                return jsonify({'success': False, 'error': 'You are already a member of this community'})
            
            # Add user to community as a member
            c.execute("""
                INSERT INTO user_communities (user_id, community_id, joined_at)
                VALUES (?, ?, NOW())
            """, (user_id, community_id))

            # If the community has a parent, auto-add membership to the parent community as well
            try:
                c.execute("SELECT parent_community_id FROM communities WHERE id = ?", (community_id,))
                parent_row = c.fetchone()
                parent_id = parent_row['parent_community_id'] if parent_row else None
                if parent_id:
                    # Check if already a member of the parent
                    c.execute("SELECT 1 FROM user_communities WHERE user_id = ? AND community_id = ?", (user_id, parent_id))
                    if not c.fetchone():
                        c.execute("""
                            INSERT INTO user_communities (user_id, community_id, joined_at)
                            VALUES (?, ?, NOW())
                        """, (user_id, parent_id))

                        # Notify user about parent membership
                        try:
                            c.execute("SELECT name FROM communities WHERE id = ?", (parent_id,))
                            parent_name_row = c.fetchone()
                            parent_name = parent_name_row['name'] if parent_name_row else 'Parent Community'
                            c.execute("""
                                INSERT INTO notifications (user_id, from_user, type, community_id, message, link)
                                VALUES (?, ?, ?, ?, ?, ?)
                            """, (
                                username,
                                'system',
                                'community_join',
                                parent_id,
                                f'Access granted to parent community "{parent_name}".',
                                f'/community_feed/{parent_id}'
                            ))
                        except Exception as parent_notify_err:
                            logger.warning(f"Failed to create parent join notification for {username}: {parent_notify_err}")
            except Exception as parent_err:
                logger.warning(f"Parent community auto-join failed for user {username} on child {community_id}: {parent_err}")

            # Create a notification for the user with a link to the community page
            try:
                c.execute("""
                    INSERT INTO notifications (user_id, from_user, type, community_id, message, link)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (
                    username,
                    'system',
                    'community_join',
                    community_id,
                    f'Successfully joined "{community_name}". Click to visit the community.',
                    f'/community_feed/{community_id}'
                ))
            except Exception as notify_err:
                logger.warning(f"Failed to create join notification for {username}: {notify_err}")

            conn.commit()
            
        return jsonify({
            'success': True, 
            'community_id': community_id,
            'community_name': community_name,
            'community_type': community_type,
            'message': f'Successfully joined "{community_name}"!'
        })
        
    except Exception as e:
        logger.error(f"Error joining community: {str(e)}")
        return jsonify({'success': False, 'error': 'An error occurred while joining the community'})

@app.route('/leave_community', methods=['POST'])
@login_required
def leave_community():
    """Leave a community"""
    username = session.get('username')
    community_id = request.form.get('community_id')
    
    if not community_id:
        return jsonify({'success': False, 'error': 'Community ID is required'})
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Get user ID
            c.execute("SELECT rowid FROM users WHERE username = ?", (username,))
            user = c.fetchone()
            if not user:
                return jsonify({'success': False, 'error': 'User not found'})
            
            user_id = user['rowid']
            
            # Check if user is a member
            c.execute("""
                SELECT id FROM user_communities 
                WHERE user_id = ? AND community_id = ?
            """, (user_id, community_id))
            
            membership = c.fetchone()
            if not membership:
                return jsonify({'success': False, 'error': 'You are not a member of this community'})
            
            # Check if user is the creator (creators cannot leave their own community)
            c.execute("SELECT creator_username FROM communities WHERE id = ?", (community_id,))
            community = c.fetchone()
            if community and community['creator_username'] == username:
                return jsonify({'success': False, 'error': 'Community creators cannot leave their own community. Delete the community instead.'})
            
            # Remove user from community
            c.execute("""
                DELETE FROM user_communities 
                WHERE user_id = ? AND community_id = ?
            """, (user_id, community_id))
            
            conn.commit()
            
        return jsonify({'success': True, 'message': 'Successfully left the community'})
        
    except Exception as e:
        logger.error(f"Error leaving community: {str(e)}")
        return jsonify({'success': False, 'error': 'An error occurred while leaving the community'})
@app.route('/community_feed/<int:community_id>')
@login_required
def community_feed(community_id):
    """Community-specific social feed"""
    username = session.get('username')
    # Mobile users -> React version
    try:
        ua = request.headers.get('User-Agent', '')
        if any(k in ua for k in ['Mobi', 'Android', 'iPhone', 'iPad']):
            return redirect(url_for('community_feed_react', community_id=community_id))
    except Exception:
        pass
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Track community visit
            try:
                c.execute("""
                    INSERT INTO community_visit_history (username, community_id, visit_time)
                    VALUES (?, ?, ?)
                """, (username, community_id, datetime.now().isoformat()))
                conn.commit()
            except Exception as e:
                logger.error(f"Error tracking community visit: {e}")
            
            # Get community info
            c.execute("SELECT * FROM communities WHERE id = ?", (community_id,))
            community_row = c.fetchone()
            if not community_row:
                logger.error(f"Community with id {community_id} not found")
                return jsonify({'success': False, 'error': 'Community not found'}), 404
            
            community = dict(community_row)
            
            # Check if community is deactivated
            if not community.get('is_active', True):
                # Allow admin to override with a parameter
                admin_override = request.args.get('admin_override') == 'true'
                if username != 'admin' or not admin_override:
                    # Show the deactivated notification page
                    return render_template('community_deactivated.html', 
                                         community=community, 
                                         username=username)
            
            # Get parent community info if it exists
            parent_community = None
            if community.get('parent_community_id'):
                c.execute("SELECT id, name, type FROM communities WHERE id = ?", (community['parent_community_id'],))
                parent_row = c.fetchone()
                if parent_row:
                    parent_community = dict(parent_row)
            
            # Get posts for this community
            c.execute("""
                SELECT * FROM posts 
                WHERE community_id = ? 
                ORDER BY id DESC
            """, (community_id,))
            posts_raw = c.fetchall()
            posts = [dict(row) for row in posts_raw]
            
            # Add reactions and replies to each post
            for post in posts:
                # Initialize reactions
                post['reactions'] = {}
                post['replies'] = []
                post['user_reaction'] = None
                
                # Fetch reactions for each post
                c.execute("""
                    SELECT reaction_type, COUNT(*) as count
                    FROM reactions
                    WHERE post_id = ?
                    GROUP BY reaction_type
                """, (post['id'],))
                reactions_raw = c.fetchall()
                post['reactions'] = {r['reaction_type']: r['count'] for r in reactions_raw}

                # Get the current logged-in user's reaction to this post
                c.execute("SELECT reaction_type FROM reactions WHERE post_id = ? AND username = ?", (post['id'], username))
                user_reaction_raw = c.fetchone()
                post['user_reaction'] = user_reaction_raw['reaction_type'] if user_reaction_raw else None

                # Fetch poll data for this post
                c.execute("SELECT * FROM polls WHERE post_id = ? AND is_active = 1", (post['id'],))
                poll_raw = c.fetchone()
                if poll_raw:
                    poll = dict(poll_raw)
                    # Fetch poll options
                    c.execute("SELECT * FROM poll_options WHERE poll_id = ? ORDER BY id", (poll['id'],))
                    options_raw = c.fetchall()
                    poll['options'] = [dict(option) for option in options_raw]
                    
                    # Get user's vote
                    c.execute("SELECT option_id FROM poll_votes WHERE poll_id = ? AND username = ?", (poll['id'], username))
                    user_vote_raw = c.fetchone()
                    poll['user_vote'] = user_vote_raw['option_id'] if user_vote_raw else None
                    
                    # Calculate total votes
                    total_votes = sum(option['votes'] for option in poll['options'])
                    poll['total_votes'] = total_votes
                    
                    post['poll'] = poll
                else:
                    post['poll'] = None

                # Fetch replies for each post
                c.execute("SELECT * FROM replies WHERE post_id = ? ORDER BY timestamp DESC", (post['id'],))
                replies_raw = c.fetchall()
                post['replies'] = [dict(row) for row in replies_raw]
                
                # Add reaction counts for each reply
                for reply in post['replies']:
                    reply['reactions'] = {}
                    reply['user_reaction'] = None
                    
                    c.execute("""
                        SELECT reaction_type, COUNT(*) as count
                        FROM reply_reactions
                        WHERE reply_id = ?
                        GROUP BY reaction_type
                    """, (reply['id'],))
                    rr = c.fetchall()
                    reply['reactions'] = {r['reaction_type']: r['count'] for r in rr}
                    
                    c.execute("SELECT reaction_type FROM reply_reactions WHERE reply_id = ? AND username = ?", (reply['id'], username))
                    ur = c.fetchone()
                    reply['user_reaction'] = ur['reaction_type'] if ur else None
            
            # Get unread notification count (safely handle if table doesn't exist)
            unread_notifications = 0
            try:
                c.execute("""
                    SELECT COUNT(*) as count 
                    FROM notifications 
                    WHERE user_id = ? AND is_read = 0
                """, (username,))
                result = c.fetchone()
                if result:
                    unread_notifications = result['count']
            except Exception as e:
                logger.debug(f"Notifications table not available or error: {e}")
                unread_notifications = 0
            
            # Get unread message count
            unread_messages = 0
            try:
                c.execute("""
                    SELECT COUNT(DISTINCT sender) as count 
                    FROM messages 
                    WHERE receiver = ? AND is_read = 0
                """, (username,))
                result = c.fetchone()
                if result:
                    unread_messages = result['count']
            except Exception as e:
                logger.debug(f"Messages query error: {e}")
                unread_messages = 0
            
            # Check if user is a community admin
            is_community_admin_user = is_community_admin(username, community_id)
            
            return render_template('community_feed.html', 
                                posts=posts, 
                                community=community,
                                parent_community=parent_community,
                                username=username,
                                unread_notifications=unread_notifications,
                                unread_messages=unread_messages,
                                is_community_admin=is_community_admin_user)
            
    except Exception as e:
        logger.error(f"Error loading community feed: {str(e)}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        return jsonify({'success': False, 'error': f'Failed to load community feed: {str(e)}'}), 500



@app.errorhandler(500)
def internal_server_error(e):
    logger.error(f"Internal server error: {str(e)}")
    return render_template('error.html', error="An internal server error occurred. Please try again later."), 500

@app.errorhandler(404)
def not_found_error(e):
    logger.error(f"404 Not Found error: {str(e)}")
    return render_template('error.html', error="Page not found. Please check the URL or return to the homepage."), 404

# Add this after the existing routes, before the error handlers

@app.route('/uploads/<path:filename>')
def uploaded_file(filename):
    """Serve uploaded images with proper headers for mobile compatibility"""
    try:
        # Log the request for debugging
        logger.info(f"Image request: {filename} from {request.headers.get('User-Agent', 'Unknown')}")
        
        # Clean the filename (remove any 'uploads/' prefix if present)
        clean_filename = filename.replace('uploads/', '') if filename.startswith('uploads/') else filename
        
        # Construct the full path
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], clean_filename)
        
        # Check if file exists
        if not os.path.exists(file_path):
            logger.error(f"Image file not found: {file_path}")
            # Try alternative paths
            alt_paths = [
                os.path.join(app.config['UPLOAD_FOLDER'], filename),
                os.path.join('static', 'uploads', clean_filename),
                os.path.join('static', 'uploads', filename)
            ]
            for alt_path in alt_paths:
                if os.path.exists(alt_path):
                    logger.info(f"Found image at alternative path: {alt_path}")
                    return send_from_directory(os.path.dirname(alt_path), os.path.basename(alt_path))
            
            return "Image not found", 404
        
        # Get file info
        file_size = os.path.getsize(file_path)
        logger.info(f"Serving image: {clean_filename}, size: {file_size} bytes")
        
        # Set proper headers for mobile compatibility
        response = send_from_directory(app.config['UPLOAD_FOLDER'], clean_filename)
        response.headers['Cache-Control'] = 'public, max-age=31536000'  # Cache for 1 year
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Content-Type'] = 'image/jpeg'  # Will be overridden by Flask if needed
        
        return response
        
    except Exception as e:
        logger.error(f"Error serving image {filename}: {str(e)}")
        return "Error serving image", 500

@app.route('/community_feed_smart/<int:community_id>')
@login_required
def community_feed_smart(community_id):
    """Serve HTML on desktop and React on mobile based on User-Agent."""
    try:
        ua = request.headers.get('User-Agent', '')
        is_mobile = any(k in ua for k in ['Mobi', 'Android', 'iPhone', 'iPad'])
        if is_mobile:
            base_dir = os.path.dirname(os.path.abspath(__file__))
            dist_dir = os.path.join(base_dir, 'client', 'dist')
            return send_from_directory(dist_dir, 'index.html')
        # Fallback to HTML feed
        return redirect(url_for('community_feed', community_id=community_id))
    except Exception as e:
        logger.error(f"Error in community_feed_smart: {e}")
        abort(500)

@app.route('/api/community_feed/<int:community_id>')
@login_required
def api_community_feed(community_id):
    """JSON API for community feed data (posts, polls, replies, reactions)."""
    username = session.get('username')
    try:
        with get_db_connection() as conn:
            c = conn.cursor()

            # Community info
            c.execute("SELECT * FROM communities WHERE id = ?", (community_id,))
            community_row = c.fetchone()
            if not community_row:
                return jsonify({'success': False, 'error': 'Community not found'}), 404
            community = dict(community_row)

            # Parent community (optional)
            parent_community = None
            if community.get('parent_community_id'):
                c.execute("SELECT id, name, type FROM communities WHERE id = ?", (community['parent_community_id'],))
                parent_row = c.fetchone()
                if parent_row:
                    parent_community = dict(parent_row)

            # Current user's profile picture
            try:
                c.execute("SELECT display_name, profile_picture FROM user_profiles WHERE username = ?", (username,))
                cupp = c.fetchone()
                current_user_profile_picture = cupp['profile_picture'] if cupp and 'profile_picture' in cupp.keys() else None
                current_user_display_name = cupp['display_name'] if cupp and 'display_name' in cupp.keys() and cupp['display_name'] else username
            except Exception:
                current_user_profile_picture = None
                current_user_display_name = username

            # Posts
            c.execute(
                """
                SELECT * FROM posts 
                WHERE community_id = ? 
                ORDER BY id DESC
                """,
                (community_id,)
            )
            posts_raw = c.fetchall()
            posts = [dict(row) for row in posts_raw]

            # Enrich posts
            for post in posts:
                post_id = post['id']
                # Add profile picture for post author
                try:
                    c.execute("SELECT profile_picture FROM user_profiles WHERE username = ?", (post['username'],))
                    pp = c.fetchone()
                    post['profile_picture'] = pp['profile_picture'] if pp and 'profile_picture' in pp.keys() else None
                except Exception:
                    post['profile_picture'] = None
                # Reaction counts for post
                c.execute(
                    """
                    SELECT reaction_type, COUNT(*) as count
                    FROM reactions
                    WHERE post_id = ?
                    GROUP BY reaction_type
                    """,
                    (post_id,)
                )
                post['reactions'] = {r['reaction_type']: r['count'] for r in c.fetchall()}

                # Current user's reaction
                c.execute("SELECT reaction_type FROM reactions WHERE post_id = ? AND username = ?", (post_id, username))
                r = c.fetchone()
                post['user_reaction'] = r['reaction_type'] if r else None

                # Active poll on this post (if any)
                c.execute("SELECT * FROM polls WHERE post_id = ? AND is_active = 1", (post_id,))
                poll_raw = c.fetchone()
                if poll_raw:
                    poll = dict(poll_raw)
                    c.execute("SELECT * FROM poll_options WHERE poll_id = ? ORDER BY id", (poll['id'],))
                    options = [dict(o) for o in c.fetchall()]
                    poll['options'] = options
                    # Current user's vote
                    c.execute("SELECT option_id FROM poll_votes WHERE poll_id = ? AND username = ?", (poll['id'], username))
                    uv = c.fetchone()
                    poll['user_vote'] = uv['option_id'] if uv else None
                    poll['total_votes'] = sum(opt.get('votes', 0) for opt in options)
                    post['poll'] = poll
                else:
                    post['poll'] = None

                # Replies
                c.execute("SELECT * FROM replies WHERE post_id = ? ORDER BY timestamp DESC", (post_id,))
                replies = [dict(row) for row in c.fetchall()]
                # Attach profile pictures for replies
                for reply in replies:
                    try:
                        c.execute("SELECT profile_picture FROM user_profiles WHERE username = ?", (reply['username'],))
                        pr = c.fetchone()
                        reply['profile_picture'] = pr['profile_picture'] if pr and 'profile_picture' in pr.keys() else None
                    except Exception:
                        reply['profile_picture'] = None
                for reply in replies:
                    # Add profile picture for reply author
                    try:
                        c.execute("SELECT profile_picture FROM user_profiles WHERE username = ?", (reply['username'],))
                        pr = c.fetchone()
                        reply['profile_picture'] = pr['profile_picture'] if pr and 'profile_picture' in pr.keys() else None
                    except Exception:
                        reply['profile_picture'] = None
                    reply_id = reply['id']
                    c.execute(
                        """
                        SELECT reaction_type, COUNT(*) as count
                        FROM reply_reactions
                        WHERE reply_id = ?
                        GROUP BY reaction_type
                        """,
                        (reply_id,)
                    )
                    reply['reactions'] = {rr['reaction_type']: rr['count'] for rr in c.fetchall()}
                    c.execute("SELECT reaction_type FROM reply_reactions WHERE reply_id = ? AND username = ?", (reply_id, username))
                    urr = c.fetchone()
                    reply['user_reaction'] = urr['reaction_type'] if urr else None
                post['replies'] = replies

            return jsonify({
                'success': True,
                'community': community,
                'parent_community': parent_community,
                'username': username,
                'is_community_admin': is_community_admin(username, community_id),
                'current_user_profile_picture': current_user_profile_picture,
                'current_user_display_name': current_user_display_name,
                'posts': posts,
            })
    except Exception as e:
        logger.error(f"Error in api_community_feed for {community_id}: {e}")
        return jsonify({'success': False, 'error': 'Server error'}), 500
def api_home_timeline():
    """Aggregate timeline across all communities the user belongs to for the last 48 hours."""
    username = session.get('username')
    try:
        with get_db_connection() as conn:
            c = conn.cursor()

            # Current user profile
            try:
                c.execute("SELECT display_name, profile_picture FROM user_profiles WHERE username = ?", (username,))
                cupp = c.fetchone()
                current_user_profile_picture = cupp['profile_picture'] if cupp and 'profile_picture' in cupp.keys() else None
                current_user_display_name = cupp['display_name'] if cupp and 'display_name' in cupp.keys() and cupp['display_name'] else username
            except Exception:
                current_user_profile_picture = None
                current_user_display_name = username

            # Get community ids for the user
            c.execute("""
                SELECT c.id, c.name
                FROM communities c
                JOIN user_communities uc ON c.id = uc.community_id
                JOIN users u ON uc.user_id = u.id
                WHERE u.username = ?
            """, (username,))
            rows = c.fetchall()
            community_ids = [row['id'] for row in rows]
            id_to_name = {row['id']: row['name'] for row in rows}

            if not community_ids:
                return jsonify({
                    'success': True,
                    'username': username,
                    'current_user_profile_picture': current_user_profile_picture,
                    'current_user_display_name': current_user_display_name,
                    'posts': []
                })

            # Build IN clause safely
            placeholders = ",".join(["?"] * len(community_ids))
            params = list(community_ids)

            # Fetch recent posts across user's communities, then filter last 48h in Python (timestamps may have varied formats)
            c.execute(f"""
                SELECT * FROM posts
                WHERE community_id IN ({placeholders})
                ORDER BY id DESC
                LIMIT 600
            """, params)
            rows = [dict(row) for row in c.fetchall()]

            # Robust timestamp parsing
            from datetime import datetime, timedelta
            now = datetime.utcnow()
            forty_eight = timedelta(hours=48)

            def parse_ts(s: str):
                if not s:
                    return None
                try:
                    # Try ISO / SQLite default
                    return datetime.strptime(s[:19], '%Y-%m-%d %H:%M:%S')
                except Exception:
                    pass
                try:
                    # MM.DD.YY HH:MM
                    return datetime.strptime(s, '%m.%d.%y %H:%M')
                except Exception:
                    pass
                try:
                    # MM/DD/YY HH:MM AM/PM
                    return datetime.strptime(s, '%m/%d/%y %I:%M %p')
                except Exception:
                    pass
                try:
                    # Epoch seconds
                    if s.isdigit():
                        n = int(s)
                        if n < 1e12:
                            from datetime import timezone
                            return datetime.fromtimestamp(n, tz=timezone.utc).replace(tzinfo=None)
                        else:
                            from datetime import timezone
                            return datetime.fromtimestamp(n/1000, tz=timezone.utc).replace(tzinfo=None)
                except Exception:
                    pass
                try:
                    # Fallback to Python parser
                    return datetime.fromisoformat(s.replace(' ', 'T')[:19])
                except Exception:
                    return None

            posts = []
            for r in rows:
                dt = parse_ts(str(r.get('timestamp', '')))
                if dt is None:
                    # If cannot parse, include conservatively
                    continue
                if now - dt <= forty_eight:
                    posts.append(r)

            # Enrich posts with author picture, reactions, user reaction, poll, replies_count, and community_name
            for post in posts:
                post_id = post['id']
                comm_id = post.get('community_id')
                post['community_name'] = id_to_name.get(comm_id)

                # Profile picture
                try:
                    c.execute("SELECT profile_picture FROM user_profiles WHERE username = ?", (post['username'],))
                    pp = c.fetchone()
                    post['profile_picture'] = pp['profile_picture'] if pp and 'profile_picture' in pp.keys() else None
                except Exception:
                    post['profile_picture'] = None

                # Reactions
                c.execute("""
                    SELECT reaction_type, COUNT(*) as count
                    FROM reactions WHERE post_id = ? GROUP BY reaction_type
                """, (post_id,))
                post['reactions'] = {r['reaction_type']: r['count'] for r in c.fetchall()}
                c.execute("SELECT reaction_type FROM reactions WHERE post_id = ? AND username = ?", (post_id, username))
                ur = c.fetchone()
                post['user_reaction'] = ur['reaction_type'] if ur else None

                # Poll (if active)
                c.execute("SELECT * FROM polls WHERE post_id = ? AND is_active = 1", (post_id,))
                poll_raw = c.fetchone()
                if poll_raw:
                    poll = dict(poll_raw)
                    c.execute("SELECT * FROM poll_options WHERE poll_id = ? ORDER BY id", (poll['id'],))
                    options = [dict(o) for o in c.fetchall()]
                    poll['options'] = options
                    c.execute("SELECT option_id FROM poll_votes WHERE poll_id = ? AND username = ?", (poll['id'], username))
                    uv = c.fetchone()
                    poll['user_vote'] = uv['option_id'] if uv else None
                    poll['total_votes'] = sum(opt.get('votes', 0) for opt in options)
                    post['poll'] = poll
                else:
                    post['poll'] = None

                # Replies count
                c.execute("SELECT COUNT(*) as cnt FROM replies WHERE post_id = ?", (post_id,))
                rc = c.fetchone()
                post['replies_count'] = (rc['cnt'] if isinstance(rc, dict) else rc[0]) if rc is not None else 0

            return jsonify({
                'success': True,
                'username': username,
                'current_user_profile_picture': current_user_profile_picture,
                'current_user_display_name': current_user_display_name,
                'posts': posts
            })
    except Exception as e:
        logger.error(f"Error in api_home_timeline: {e}")
        return jsonify({'success': False, 'error': 'Server error'}), 500

@app.route('/api/home_timeline')
@login_required
def api_home_timeline_route():
    return api_home_timeline()

@app.route('/home')
@login_required
def react_home_timeline_page():
    try:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        dist_dir = os.path.join(base_dir, 'client', 'dist')
        return send_from_directory(dist_dir, 'index.html')
    except Exception as e:
        logger.error(f"Error serving React home timeline: {str(e)}")
        abort(500)
@app.route('/community_feed_react/<int:community_id>')
@login_required
def community_feed_react(community_id):
    try:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        dist_dir = os.path.join(base_dir, 'client', 'dist')
        return send_from_directory(dist_dir, 'index.html')
    except Exception as e:
        logger.error(f"Error serving React community feed: {str(e)}")
        abort(500)

@app.route('/community/<int:community_id>/calendar_react')
@login_required
def community_calendar_react(community_id):
    try:
        ua = request.headers.get('User-Agent', '')
        is_mobile = any(k in ua for k in ['Mobi', 'Android', 'iPhone', 'iPad'])
        if is_mobile:
            base_dir = os.path.dirname(os.path.abspath(__file__))
            dist_dir = os.path.join(base_dir, 'client', 'dist')
            return send_from_directory(dist_dir, 'index.html')
        # Desktop: fall back to existing HTML calendar if available
        return redirect(f"/community/{community_id}/calendar")
    except Exception as e:
        logger.error(f"Error serving React community calendar: {str(e)}")
        abort(500)

@app.route('/post/<int:post_id>')
@login_required
def react_post_detail(post_id):
    try:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        dist_dir = os.path.join(base_dir, 'client', 'dist')
        return send_from_directory(dist_dir, 'index.html')
    except Exception as e:
        logger.error(f"Error serving React post detail: {str(e)}")
        abort(500)

@app.route('/community/<int:community_id>/members')
@login_required
def react_members_page(community_id):
    try:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        dist_dir = os.path.join(base_dir, 'client', 'dist')
        return send_from_directory(dist_dir, 'index.html')
    except Exception as e:
        logger.error(f"Error serving React community members page: {str(e)}")
        abort(500)
@app.route('/static/uploads/<path:filename>')
def static_uploaded_file(filename):
    """Alternative route for static uploads"""
    try:
        logger.info(f"Static image request: {filename}")
        return send_from_directory('static/uploads', filename)
    except Exception as e:
        logger.error(f"Error serving static image {filename}: {str(e)}")
        return "Error serving image", 500

@app.route('/static/community_backgrounds/<path:filename>')
def community_background_file(filename):
    """Serve community background images"""
    try:
        logger.info(f"Community background request: {filename}")
        # Check if file exists
        import os
        # Check in uploads folder first (where files are actually saved)
        upload_path = os.path.join(app.config['UPLOAD_FOLDER'], 'community_backgrounds', filename)
        static_path = os.path.join('static', 'community_backgrounds', filename)
        
        if os.path.exists(upload_path):
            return send_from_directory(os.path.join(app.config['UPLOAD_FOLDER'], 'community_backgrounds'), filename)
        elif os.path.exists(static_path):
            return send_from_directory('static/community_backgrounds', filename)
        else:
            logger.warning(f"Community background file not found in uploads or static: {filename}")
            # Return a transparent 1x1 pixel instead of 404
            from flask import Response
            transparent_pixel = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x00\x00\x02\x00\x01\xe5\x27\xde\xfc\x00\x00\x00\x00IEND\xaeB`\x82'
            return Response(transparent_pixel, mimetype='image/png')
    except Exception as e:
        logger.error(f"Error serving community background {filename}: {str(e)}")
        return "Error serving image", 500

@app.route('/your_sports')
@login_required
def your_sports():
    username = session.get('username')
    try:
        ua = request.headers.get('User-Agent', '')
        is_mobile = any(k in ua for k in ['Mobi', 'Android', 'iPhone', 'iPad'])
        if is_mobile:
            base_dir = os.path.dirname(os.path.abspath(__file__))
            dist_dir = os.path.join(base_dir, 'client', 'dist')
            return send_from_directory(dist_dir, 'index.html')
        return render_template('your_sports.html', username=username)
    except Exception:
        return render_template('your_sports.html', username=username)

@app.route('/gym_react')
@login_required
def gym_react():
    return redirect(url_for('workout_tracking'))

@app.route('/crossfit')
@login_required
def crossfit():
    try:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        dist_dir = os.path.join(base_dir, 'client', 'dist')
        return send_from_directory(dist_dir, 'index.html')
    except Exception as e:
        logger.error(f"Error serving /crossfit: {str(e)}")
        abort(500)

@app.route('/crossfit_react')
@login_required
def crossfit_react():
    try:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        dist_dir = os.path.join(base_dir, 'client', 'dist')
        index_path = os.path.join(dist_dir, 'index.html')
        if os.path.exists(index_path):
            return send_from_directory(dist_dir, 'index.html')
        logger.warning("React build missing for /crossfit_react; redirecting to /crossfit")
        return redirect(url_for('crossfit'))
    except Exception as e:
        logger.error(f"Error serving React CrossfitExact: {str(e)}")
        abort(500)

@app.route('/cf_add_entry', methods=['POST'])
@login_required
def cf_add_entry():
    try:
        username = session.get('username')
        entry_type = request.form.get('type', '').strip().lower()
        name = request.form.get('name', '').strip()
        weight = request.form.get('weight', '').strip()
        reps = request.form.get('reps', '').strip()
        score = request.form.get('score', '').strip()
        date = request.form.get('date', '').strip()

        # Basic validation
        if not entry_type or not name or not date:
            return jsonify({'success': False, 'error': 'Type, name and date are required'})

        with get_db_connection() as conn:
            c = conn.cursor()

            c.execute('''
                CREATE TABLE IF NOT EXISTS crossfit_entries (
                    id INTEGER PRIMARY KEY AUTO_INCREMENT,
                    username TEXT NOT NULL,
                    type TEXT NOT NULL,
                    name TEXT NOT NULL,
                    weight REAL,
                    reps INTEGER,
                    score TEXT,
                    score_numeric REAL,
                    created_at TEXT NOT NULL
                )
            ''')

        # Helper to parse time strings like HH:MM:SS or MM:SS
        def parse_time_to_seconds(value: str):
            try:
                parts = value.split(':')
                parts = [int(p) for p in parts]
                if len(parts) == 3:
                    return parts[0]*3600 + parts[1]*60 + parts[2]
                if len(parts) == 2:
                    return parts[0]*60 + parts[1]
            except Exception:
                pass
            try:
                # Fallback if numeric like 315.5 (seconds)
                return float(value)
            except Exception:
                return None

        score_numeric = None
        weight_val = float(weight) if weight not in (None, '',) else None
        reps_val = int(reps) if reps not in (None, '',) else None
        if entry_type == 'wod':
            # Prefer explicit score_numeric, else parse score string
            if score:
                score_numeric = parse_time_to_seconds(score)

            c.execute('''
                INSERT INTO crossfit_entries (username, type, name, weight, reps, score, score_numeric, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''', (username, entry_type, name, weight_val, reps_val, score if score else None, score_numeric, date))

            conn.commit()
            return jsonify({'success': True})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/sync_gym_to_crossfit', methods=['POST'])
@login_required
def sync_gym_to_crossfit():
    try:
        username = session.get('username')
        with get_db_connection() as conn:
            c = conn.cursor()
            # Find overlapping exercise names
            overlapping = {'Back Squat','Front Squat','Overhead Squat','Deadlift','Clean','Jerk','Clean & Jerk','Snatch','Bench Press','Push Press','Thruster','Overhead Press'}
            # Get all user gym sets for overlapping exercises
            c.execute('''
                SELECT e.name, es.weight, es.reps, es.created_at
                FROM exercises e
                JOIN exercise_sets es ON e.id = es.exercise_id
                WHERE e.username = ? AND e.name IN ({})
            '''.format(','.join('?'*len(overlapping))), (username, *overlapping))
            rows = c.fetchall()

            c.execute('''CREATE TABLE IF NOT EXISTS crossfit_entries (
                id INTEGER PRIMARY KEY AUTO_INCREMENT,
                username TEXT NOT NULL,
                type TEXT NOT NULL,
                name TEXT NOT NULL,
                weight REAL,
                reps INTEGER,
                score TEXT,
                score_numeric REAL,
                created_at TEXT NOT NULL
            )''')

            # Insert any missing entries
            for r in rows:
                name, weight, reps, created_at = r
                c.execute('''INSERT INTO crossfit_entries (username, type, name, weight, reps, created_at)
                             VALUES (?, 'lift', ?, ?, ?, ?)''', (username, name, weight, reps, created_at))

            conn.commit()
        return jsonify({'success': True, 'synced': len(rows)})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/cf_compare_item_in_box', methods=['GET'])
@login_required
def cf_compare_item_in_box():
    try:
        username = session.get('username')
        community_id = int(request.args.get('community_id', '0'))
        item_type = request.args.get('item_type', 'lift').strip().lower()
        item_name = request.args.get('item_name', '').strip()
        if not community_id or not item_type or not item_name:
            return jsonify({'success': False, 'error': 'Missing parameters'})
        with get_db_connection() as conn:
            c = conn.cursor()

            # Community users
            c.execute(
                '''
                SELECT u.username
                FROM user_communities uc
                JOIN users u ON uc.user_id = u.id
                WHERE uc.community_id = ?
                ''',
                (community_id,)
            )
            users = [row['username'] for row in c.fetchall()]
            if not users:
                return jsonify({'success': False, 'error': 'No users in community'})

            # Helper to parse time strings
            def parse_time_to_seconds(value: str):
                try:
                    parts = value.split(':')
                    parts = [int(p) for p in parts]
                    if len(parts) == 3:
                        return parts[0]*3600 + parts[1]*60 + parts[2]
                    if len(parts) == 2:
                        return parts[0]*60 + parts[1]
                except Exception:
                    pass
                try:
                    return float(value)
                except Exception:
                    return None

            values = []
            user_value = None

            if item_type == 'lift':
                for user in users:
                    c.execute(
                        '''
                        SELECT MAX(weight) as val
                        FROM crossfit_entries
                        WHERE username = ? AND type = 'lift' AND name = ?
                        ''',
                        (user, item_name)
                    )
                    row = c.fetchone()
                    val = row['val'] if row and row['val'] is not None else 0
                    values.append(val)
                    if user == username:
                        user_value = val
                valid = [v for v in values if v and v > 0]
                avg = round(sum(valid)/len(valid), 1) if valid else 0
                top = round(max(valid), 1) if valid else 0
                percentile = 0
                if valid and user_value and user_value > 0:
                    less_or_equal = sum(1 for v in valid if v <= user_value)
                    percentile = round((less_or_equal / len(valid)) * 100)
                unit = 'kg'
                lower_is_better = False
            else:  # wod
                for user in users:
                    c.execute(
                        '''
                        SELECT score, score_numeric
                        FROM crossfit_entries
                        WHERE username = ? AND type = 'wod' AND name = ?
                        ''',
                        (user, item_name)
                    )
                    rows = c.fetchall()
                    best = None
                    for r in rows:
                        n = r['score_numeric'] if r['score_numeric'] is not None else (parse_time_to_seconds(r['score']) if r['score'] else None)
                        if n is None:
                            continue
                        if best is None or n < best:
                            best = n
                    val = best if best is not None else 0
                    values.append(val)
                    if user == username:
                        user_value = val
                valid = [v for v in values if v and v > 0]
                avg = round(sum(valid)/len(valid), 1) if valid else 0
                top = round(min(valid), 1) if valid else 0  # best (fastest) time
                percentile = 0
                if valid and user_value and user_value > 0:
                    greater_or_equal = sum(1 for v in valid if v >= user_value)  # lower is better
                    percentile = round((greater_or_equal / len(valid)) * 100)
                unit = 'sec'
                lower_is_better = True

            data = {
                'labels': ['You'],
                'avgValues': [avg],
                'userValues': [user_value or 0],
                'unit': unit,
                'lowerIsBetter': lower_is_better,
            }

            if item_type == 'lift':
                summary = f"Your max for {item_name}: {user_value or 0} {unit}. Box avg: {avg} {unit}. Percentile: {percentile}% • Top: {top} {unit}"
            else:
                def fmt_seconds(s):
                    try:
                        s = int(round(s))
                        m = s // 60
                        sec = s % 60
                        return f"{m}:{sec:02d}"
                    except Exception:
                        return str(s)
                summary = f"Your best time for {item_name}: {fmt_seconds(user_value or 0)}. Box avg: {fmt_seconds(avg)}. Percentile: {percentile}% • Top: {fmt_seconds(top)}"

            return jsonify({'success': True, 'data': data, 'summary': summary, 'percentile': percentile, 'community_max': top})
    except Exception as e:
        logger.error(f"Error in CF comparison endpoint: {e}")
        return jsonify({'success': False, 'error': 'Server error'})

@app.route('/workout_generator')
@login_required
def workout_generator():
    username = session.get('username')
    return render_template('workout_generator.html', username=username)

@app.route('/workout_tracking')
@login_required
def workout_tracking():
    username = session.get('username')
    try:
        ua = request.headers.get('User-Agent', '')
        is_mobile = any(k in ua for k in ['Mobi', 'Android', 'iPhone', 'iPad'])
        if is_mobile:
            base_dir = os.path.dirname(os.path.abspath(__file__))
            dist_dir = os.path.join(base_dir, 'client', 'dist')
            return send_from_directory(dist_dir, 'index.html')
        return render_template('workout_tracking.html', username=username)
    except Exception as e:
        logger.error(f"Error in workout_tracking smart route: {e}")
        return render_template('workout_tracking.html', username=username)

# ===== WORKOUT TRACKING ROUTES =====

@app.route('/add_exercise', methods=['POST'])
@login_required
def add_exercise():
    try:
        username = session.get('username')
        name = request.form.get('name')
        muscle_group = request.form.get('muscle_group', 'Other')
        # Normalize new group values
        if muscle_group.lower() == 'glutes':
            muscle_group = 'Glutes'
        weight = request.form.get('weight')
        reps = request.form.get('reps')
        date = request.form.get('date')
        
        if not name:
            return jsonify({'success': False, 'error': 'Exercise name is required'})
        
        if not all([weight, reps, date]):
            return jsonify({'success': False, 'error': 'Weight, reps, and date are required'})
        
        conn = sqlite3.connect('users.db')
        cursor = conn.cursor()
        
        # Check if exercise already exists for this user
        cursor.execute('''
            SELECT id FROM exercises 
            WHERE username = ? AND name = ? AND muscle_group = ?
        ''', (username, name, muscle_group))
        
        if cursor.fetchone():
            return jsonify({'success': False, 'error': 'Exercise already exists'})
        
        # Create tables if they don't exist
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS exercises (
                id INTEGER PRIMARY KEY AUTO_INCREMENT,
                username TEXT NOT NULL,
                name TEXT NOT NULL,
                muscle_group TEXT NOT NULL DEFAULT "Other"
            )
        ''')
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS exercise_sets (
                id INTEGER PRIMARY KEY AUTO_INCREMENT,
                exercise_id INTEGER NOT NULL,
                weight REAL NOT NULL,
                reps INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (exercise_id) REFERENCES exercises (id) ON DELETE CASCADE
            )
        ''')
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS workouts (
                id INTEGER PRIMARY KEY AUTO_INCREMENT,
                username TEXT NOT NULL,
                name TEXT NOT NULL,
                date TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS workout_exercises (
                id INTEGER PRIMARY KEY AUTO_INCREMENT,
                workout_id INTEGER NOT NULL,
                exercise_id INTEGER NOT NULL,
                sets INTEGER DEFAULT 0,
                reps INTEGER DEFAULT 0,
                weight REAL DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (workout_id) REFERENCES workouts (id) ON DELETE CASCADE,
                FOREIGN KEY (exercise_id) REFERENCES exercises (id) ON DELETE CASCADE
            )
        ''')
        
        # Insert the exercise
        cursor.execute('''
            INSERT INTO exercises (username, name, muscle_group)
            VALUES (?, ?, ?)
        ''', (username, name, muscle_group))
        
        exercise_id = cursor.lastrowid
        print(f"Debug: Inserted exercise with ID: {exercise_id}")
        
        # Insert the initial weight entry
        cursor.execute('''
            INSERT INTO exercise_sets (exercise_id, weight, reps, created_at)
            VALUES (?, ?, ?, ?)
        ''', (exercise_id, weight, reps, date))
        
        print(f"Debug: Added initial weight entry: {weight}kg x {reps} reps on {date}")
        
        # Cross-sync initial entry to crossfit_entries for overlapping lift names
        try:
            overlapping = {'Back Squat','Front Squat','Overhead Squat','Deadlift','Clean','Jerk','Clean & Jerk','Snatch','Bench Press','Push Press','Thruster','Overhead Press'}
            if name in overlapping:
                cursor.execute('''
                    CREATE TABLE IF NOT EXISTS crossfit_entries (
                        id INTEGER PRIMARY KEY AUTO_INCREMENT,
                        username TEXT NOT NULL,
                        type TEXT NOT NULL,
                        name TEXT NOT NULL,
                        weight REAL,
                        reps INTEGER,
                        score TEXT,
                        score_numeric REAL,
                        created_at TEXT NOT NULL
                    )
                ''')
                cursor.execute('''
                    INSERT INTO crossfit_entries (username, type, name, weight, reps, created_at)
                    VALUES (?, 'lift', ?, ?, ?, ?)
                ''', (username, name, float(weight), int(reps), date))
        except Exception as _e:
            pass
        
        conn.commit()
        conn.close()
        
        print(f"Debug: Exercise added successfully for user {username}")
        return jsonify({'success': True})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})
@app.route('/get_workout_exercises', methods=['GET'])
@login_required
def get_workout_exercises():
    try:
        username = session.get('username')
        
        conn = sqlite3.connect('users.db')
        cursor = conn.cursor()
        
        # Get exercises with data from both exercise_sets (Exercise Management) and workout_exercises (Workouts)
        cursor.execute('''
            SELECT e.id, e.name, e.muscle_group,
                   COALESCE(es.weight, we.weight) as set_weight,
                   COALESCE(es.reps, we.reps) as set_reps,
                   COALESCE(es.created_at, we.created_at) as created_at,
                   CASE WHEN es.id IS NOT NULL THEN 'exercise_management' ELSE 'workout' END as source
            FROM exercises e
            LEFT JOIN exercise_sets es ON e.id = es.exercise_id
            LEFT JOIN workout_exercises we ON e.id = we.exercise_id
            WHERE e.username = ?
            ORDER BY e.muscle_group, e.name, COALESCE(es.created_at, we.created_at) DESC
        ''', (username,))
        
        rows = cursor.fetchall()
        conn.close()
        
        print(f"Debug: Found {len(rows)} rows for user {username}")
        print(f"Debug: First few rows: {rows[:3]}")
        
        if not rows:
            return jsonify({'success': True, 'exercises': []})
        
        # Group exercises by muscle group
        exercises = []
        current_exercise = None
        
        for row in rows:
            exercise_id = row[0]
            exercise_name = row[1]
            muscle_group = row[2]
            
            # If this is a new exercise
            if not current_exercise or current_exercise['id'] != exercise_id:
                current_exercise = {
                    'id': exercise_id,
                    'name': exercise_name,
                    'muscle_group': muscle_group,
                    'sets_data': []
                }
                exercises.append(current_exercise)
            
            # Add set data if it exists (from either Exercise Management or Workouts)
            if row[3]:  # If there's weight data
                current_exercise['sets_data'].append({
                    'weight': row[3],
                    'reps': row[4],
                    'created_at': row[5],
                    'source': row[6]  # 'exercise_management' or 'workout'
                })
        
        print(f"Debug: Returning {len(exercises)} exercises for user {username}")
        print(f"Debug: Exercises data: {exercises}")
        
        # Debug: Check if exercises have sets_data
        for exercise in exercises:
            print(f"Debug: Exercise {exercise['name']} has {len(exercise['sets_data'])} sets")
            if exercise['sets_data']:
                print(f"Debug: First set: {exercise['sets_data'][0]}")
        
        return jsonify({'success': True, 'exercises': exercises})
        
    except Exception as e:
        print(f"Debug: Error in get_workout_exercises: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/edit_exercise', methods=['POST'])
@login_required
def edit_exercise():
    try:
        username = session.get('username')
        exercise_id = request.form.get('exercise_id')
        name = request.form.get('name')
        muscle_group = request.form.get('muscle_group', '').strip()
        
        if not exercise_id:
            return jsonify({'success': False, 'error': 'Exercise ID is required'})
        if not name and not muscle_group:
            return jsonify({'success': False, 'error': 'Nothing to update'})
        
        conn = sqlite3.connect('users.db')
        cursor = conn.cursor()
        
        # Normalize and validate muscle group if provided
        if muscle_group:
            normalized_group = muscle_group.capitalize()
            allowed_groups = {'Chest','Back','Shoulders','Biceps','Triceps','Legs','Core','Glutes','Other'}
            if normalized_group not in allowed_groups:
                normalized_group = 'Other'
        
        if name and muscle_group:
            cursor.execute('''
                UPDATE exercises 
                SET name = ?, muscle_group = ?
                WHERE id = ? AND username = ?
            ''', (name, normalized_group, exercise_id, username))
        elif name:
            cursor.execute('''
                UPDATE exercises 
                SET name = ?
                WHERE id = ? AND username = ?
            ''', (name, exercise_id, username))
        elif muscle_group:
            cursor.execute('''
                UPDATE exercises 
                SET muscle_group = ?
                WHERE id = ? AND username = ?
            ''', (normalized_group, exercise_id, username))
        
        conn.commit()
        conn.close()
        
        return jsonify({'success': True})
    except Exception as e:
        try:
            conn.close()
        except Exception:
            pass
        return jsonify({'success': False, 'error': str(e)})
@app.route('/compare_exercise_in_community', methods=['GET'])
@login_required
def compare_exercise_in_community():
    try:
        username = session.get('username')
        community_id = int(request.args.get('community_id', '0'))
        exercise_id = int(request.args.get('exercise_id', '0'))
        if not community_id or not exercise_id:
            return jsonify({'success': False, 'error': 'Missing parameters'})

        with get_db_connection() as conn:
            c = conn.cursor()
            # Get all usernames in the community
            c.execute("""
                SELECT u.username
                FROM user_communities uc
                JOIN users u ON uc.user_id = u.id
                WHERE uc.community_id = ?
            """, (community_id,))
            users = [row['username'] for row in c.fetchall()]
            if not users:
                return jsonify({'success': False, 'error': 'No users in community'})

            # For each user, compute their max weight for the selected exercise name
            # First get the exercise name for the requesting user
            c.execute("SELECT name FROM exercises WHERE id = ? AND username = ?", (exercise_id, username))
            row = c.fetchone()
            if not row:
                return jsonify({'success': False, 'error': 'Exercise not found for user'})
            exercise_name = row['name']

            community_max_weights = []
            user_max = 0
            for user in users:
                c.execute("SELECT id FROM exercises WHERE username = ? AND name = ?", (user, exercise_name))
                ex_row = c.fetchone()
                if not ex_row:
                    continue
                ex_id = ex_row['id']
                c.execute("SELECT MAX(weight) as mw FROM exercise_sets WHERE exercise_id = ?", (ex_id,))
                mw_row = c.fetchone()
                max_w = mw_row['mw'] if mw_row and mw_row['mw'] is not None else 0
                community_max_weights.append(max_w)
                if user == username:
                    user_max = max_w

            if not community_max_weights:
                return jsonify({'success': False, 'error': 'No comparable data'})

            # Compute community average and max excluding zeros
            valid = [w for w in community_max_weights if w and w > 0]
            avg = round(sum(valid) / len(valid), 1) if valid else 0
            community_max = round(max(valid), 1) if valid else 0

            # Percentile of user's max within community distribution (<= user_max)
            percentile = 0
            if valid and user_max and user_max > 0:
                less_or_equal = sum(1 for w in valid if w <= user_max)
                percentile = round((less_or_equal / len(valid)) * 100)

            data = {
                'labels': ['You'],
                'avgMaxWeights': [avg],
                'userMaxWeights': [user_max]
            }
            summary = (
                f"Your max for {exercise_name}: {user_max or 0} kg. "
                f"Community avg: {avg} kg. "
                f"Percentile: {percentile}% • Top: {community_max} kg"
            )
            return jsonify({'success': True, 'data': data, 'summary': summary, 'percentile': percentile, 'community_max': community_max})
    except Exception as e:
        logger.error(f"Error in comparison endpoint: {e}")
        return jsonify({'success': False, 'error': 'Server error'})

@app.route('/leaderboard_exercise_in_community', methods=['GET'])
@login_required
def leaderboard_exercise_in_community():
    try:
        username = session.get('username')
        community_id = int(request.args.get('community_id', '0'))
        exercise_id = int(request.args.get('exercise_id', '0'))
        if not community_id or not exercise_id:
            return jsonify({'success': False, 'error': 'Missing parameters'})

        with get_db_connection() as conn:
            c = conn.cursor()
            # Community users
            c.execute("""
                SELECT u.username
                FROM user_communities uc
                JOIN users u ON uc.user_id = u.id
                WHERE uc.community_id = ?
            """, (community_id,))
            users = [row['username'] for row in c.fetchall()]
            if not users:
                return jsonify({'success': False, 'error': 'No users in community'})

            # Get exercise name for requesting user
            c.execute("SELECT name FROM exercises WHERE id = ? AND username = ?", (exercise_id, username))
            row = c.fetchone()
            if not row:
                return jsonify({'success': False, 'error': 'Exercise not found for user'})
            exercise_name = row['name']

            # Compute each user's max for that exercise name
            leaderboard = []
            for user in users:
                c.execute("SELECT id FROM exercises WHERE username = ? AND name = ?", (user, exercise_name))
                ex_row = c.fetchone()
                if not ex_row:
                    continue
                ex_id = ex_row['id']
                c.execute("SELECT MAX(weight) as mw FROM exercise_sets WHERE exercise_id = ?", (ex_id,))
                mw_row = c.fetchone()
                max_w = mw_row['mw'] if mw_row and mw_row['mw'] is not None else 0
                leaderboard.append({ 'username': user, 'max': float(max_w) })

            # Sort descending by max
            leaderboard.sort(key=lambda x: x['max'], reverse=True)
            return jsonify({ 'success': True, 'exercise_name': exercise_name, 'entries': leaderboard })
    except Exception as e:
        logger.error(f"Error in leaderboard endpoint: {e}")
        return jsonify({'success': False, 'error': 'Server error'})

@app.route('/compare_overview_in_community', methods=['GET'])
@login_required
def compare_overview_in_community():
    """Overview across all of the user's exercises: user max, community average, percentile."""
    try:
        username = session.get('username')
        community_id = int(request.args.get('community_id', '0'))
        if not community_id:
            return jsonify({'success': False, 'error': 'Missing community_id'})

        with get_db_connection() as conn:
            c = conn.cursor()

            # Community users
            c.execute(
                """
                SELECT u.username
                FROM user_communities uc
                JOIN users u ON uc.user_id = u.id
                WHERE uc.community_id = ?
                """,
                (community_id,)
            )
            users = [row['username'] for row in c.fetchall()]
            if not users:
                return jsonify({'success': False, 'error': 'No users in community'})

            # User's exercises (include muscle group for grouping in UI)
            c.execute("SELECT id, name, muscle_group FROM exercises WHERE username = ?", (username,))
            user_exercises = c.fetchall()

            overview = []
            for ex in user_exercises:
                ex_id = ex['id']
                ex_name = ex['name']
                ex_group = ex['muscle_group'] or 'Other'

                # User max for this exercise
                c.execute("SELECT MAX(weight) as mw FROM exercise_sets WHERE exercise_id = ?", (ex_id,))
                mw_row = c.fetchone()
                user_max = mw_row['mw'] if mw_row and mw_row['mw'] is not None else 0

                # Community maxima for the same-named exercise
                maxima = []
                for user in users:
                    c.execute("SELECT id FROM exercises WHERE username = ? AND name = ?", (user, ex_name))
                    ex_row = c.fetchone()
                    if not ex_row:
                        continue
                    c.execute("SELECT MAX(weight) as mw FROM exercise_sets WHERE exercise_id = ?", (ex_row['id'],))
                    r = c.fetchone()
                    max_w = r['mw'] if r and r['mw'] is not None else 0
                    if max_w and max_w > 0:
                        maxima.append(max_w)

                community_avg = round(sum(maxima) / len(maxima), 1) if maxima else 0
                community_top = round(max(maxima), 1) if maxima else 0

                # Percentile calculation of user's max among community maxima
                percentile = 0
                if maxima and user_max and user_max > 0:
                    less_or_equal = sum(1 for w in maxima if w <= user_max)
                    percentile = round((less_or_equal / len(maxima)) * 100)

                overview.append({
                    'exercise_id': ex_id,
                    'name': ex_name,
                    'muscle_group': ex_group,
                    'user_max': float(user_max or 0),
                    'community_avg': float(community_avg or 0),
                    'community_max': float(community_top or 0),
                    'percentile': int(percentile)
                })

            return jsonify({'success': True, 'overview': overview})
    except Exception as e:
        logger.error(f"Error in comparison overview endpoint: {e}")
        return jsonify({'success': False, 'error': 'Server error'})
@app.route('/compare_attendance_in_community', methods=['GET'])
@login_required
def compare_attendance_in_community():
    """Compare number of workouts attended in a period vs community average and percentile."""
    try:
        username = session.get('username')
        community_id = int(request.args.get('community_id', '0'))
        period_days = int(request.args.get('period_days', '30'))
        if not community_id:
            return jsonify({'success': False, 'error': 'Missing community_id'})

        with get_db_connection() as conn:
            c = conn.cursor()

            # Get all usernames in the community
            c.execute(
                """
                SELECT u.username
                FROM user_communities uc
                JOIN users u ON uc.user_id = u.id
                WHERE uc.community_id = ?
                """,
                (community_id,)
            )
            users = [row['username'] for row in c.fetchall()]
            if not users:
                return jsonify({'success': False, 'error': 'No users in community'})

            # Attendance counts per user in given period
            attendance = []
            user_attendance = 0
            for user in users:
                c.execute(
                    """
                    SELECT COUNT(*) as cnt
                    FROM workouts
                    WHERE username = ? AND date >= DATE_SUB(NOW(), INTERVAL ? DAY)
                    """,
                    (user, period_days)
                )
                cnt_row = c.fetchone()
                cnt = cnt_row['cnt'] if cnt_row and cnt_row['cnt'] is not None else 0
                attendance.append(cnt)
                if user == username:
                    user_attendance = cnt

            valid = attendance  # zero is allowed for attendance
            avg = round(sum(valid) / len(valid), 1) if valid else 0
            community_max = max(valid) if valid else 0
            percentile = 0
            if valid:
                less_or_equal = sum(1 for v in valid if v <= user_attendance)
                percentile = round((less_or_equal / len(valid)) * 100)

            summary = (
                f"Attendance last {period_days}d — You: {user_attendance}, Avg: {avg}, "
                f"Pct: {percentile}% • Top: {community_max}"
            )

            return jsonify({
                'success': True,
                'attendance': {
                    'user': int(user_attendance),
                    'avg': float(avg),
                    'percentile': int(percentile),
                    'community_max': int(community_max),
                    'period_days': int(period_days)
                },
                'summary': summary
            })
    except Exception as e:
        logger.error(f"Error in attendance comparison endpoint: {e}")
        return jsonify({'success': False, 'error': 'Server error'})

@app.route('/compare_improvement_in_community', methods=['GET'])
@login_required
def compare_improvement_in_community():
    """Compare percent improvement in 1RM over timeframe vs community average and percentile."""
    try:
        username = session.get('username')
        community_id = int(request.args.get('community_id', '0'))
        months = int(request.args.get('months', '3'))
        if not community_id:
            return jsonify({'success': False, 'error': 'Missing community_id'})

        with get_db_connection() as conn:
            c = conn.cursor()

            # Community users
            c.execute(
                """
                SELECT u.username
                FROM user_communities uc
                JOIN users u ON uc.user_id = u.id
                WHERE uc.community_id = ?
                """,
                (community_id,)
            )
            users = [row['username'] for row in c.fetchall()]
            if not users:
                return jsonify({'success': False, 'error': 'No users in community'})

            # Helper to compute average improvement percent for a user across their exercises
            def compute_user_improvement(user_name: str) -> float:
                # Get user's exercises
                c.execute("SELECT id FROM exercises WHERE username = ?", (user_name,))
                user_exs = [r['id'] for r in c.fetchall()]
                improvements = []
                for ex_id in user_exs:
                    c.execute(
                        """
                        SELECT weight, reps, created_at
                        FROM exercise_sets
                        WHERE exercise_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL ? MONTH)
                        ORDER BY created_at ASC
                        """,
                        (ex_id, months)
                    )
                    sets = c.fetchall()
                    if not sets or len(sets) < 2:
                        continue
                    # Compute 1RM per entry
                    one_rms = [row['weight'] * (1 + row['reps'] / 30.0) for row in sets]
                    baseline = one_rms[0]
                    current = max(one_rms)
                    if baseline and baseline > 0:
                        improvements.append(((current - baseline) / baseline) * 100.0)
                if not improvements:
                    return 0.0
                return sum(improvements) / len(improvements)

            community_improvements = []
            user_improvement = 0.0
            for user in users:
                imp = compute_user_improvement(user)
                community_improvements.append(imp)
                if user == username:
                    user_improvement = imp

            valid = community_improvements
            avg = round(sum(valid) / len(valid), 1) if valid else 0.0
            community_max = round(max(valid), 1) if valid else 0.0
            percentile = 0
            if valid:
                less_or_equal = sum(1 for v in valid if v <= user_improvement)
                percentile = round((less_or_equal / len(valid)) * 100)

            summary = (
                f"Improvement last {months}m — You: {round(user_improvement,1)}%, Avg: {avg}%, "
                f"Pct: {percentile}% • Top: {community_max}%"
            )

            return jsonify({
                'success': True,
                'improvement': {
                    'user': round(user_improvement, 1),
                    'avg': float(avg),
                    'percentile': int(percentile),
                    'community_max': float(community_max),
                    'months': int(months)
                },
                'summary': summary
            })
    except Exception as e:
        logger.error(f"Error in improvement comparison endpoint: {e}")
        return jsonify({'success': False, 'error': 'Server error'})
@app.route('/delete_exercise', methods=['POST'])
@login_required
def delete_exercise():
    try:
        username = session.get('username')
        exercise_id = request.form.get('exercise_id')
        
        if not exercise_id:
            return jsonify({'success': False, 'error': 'Exercise ID is required'})
        
        conn = sqlite3.connect('users.db')
        cursor = conn.cursor()
        
        # Delete the exercise (sets will be deleted automatically due to CASCADE)
        cursor.execute('''
            DELETE FROM exercises 
            WHERE id = ? AND username = ?
        ''', (exercise_id, username))
        
        conn.commit()
        conn.close()
        
        return jsonify({'success': True})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/log_weight_set', methods=['POST'])
@login_required
def log_weight_set():
    try:
        username = session.get('username')
        exercise_id = request.form.get('exercise_id')
        weight = request.form.get('weight')
        reps = request.form.get('reps')
        date = request.form.get('date')
        
        print(f"Debug: Logging weight - Exercise ID: {exercise_id}, Weight: {weight}, Reps: {reps}, Date: {date}")
        
        if not all([exercise_id, weight, reps, date]):
            return jsonify({'success': False, 'error': 'All fields are required'})
        
        conn = sqlite3.connect('users.db')
        cursor = conn.cursor()
        
        # Verify the exercise belongs to the user
        cursor.execute('''
            SELECT id FROM exercises 
            WHERE id = ? AND username = ?
        ''', (exercise_id, username))
        
        if not cursor.fetchone():
            return jsonify({'success': False, 'error': 'Exercise not found'})
        
        # Add the set with the specified date
        cursor.execute('''
            INSERT INTO exercise_sets (exercise_id, weight, reps, created_at)
            VALUES (?, ?, ?, ?)
        ''', (exercise_id, weight, reps, date))

        # Cross-sync to crossfit_entries for overlapping lift names
        try:
            # Fetch exercise name
            cursor.execute('SELECT name FROM exercises WHERE id=?', (exercise_id,))
            row = cursor.fetchone()
            if row:
                ex_name = row[0] if isinstance(row, tuple) else row[0]
                # Only sync for known overlapping lifts
                overlapping = {'Back Squat','Front Squat','Overhead Squat','Deadlift','Clean','Jerk','Clean & Jerk','Snatch','Bench Press','Push Press','Thruster','Overhead Press'}
                if ex_name in overlapping:
                    cursor.execute('''
                        CREATE TABLE IF NOT EXISTS crossfit_entries (
                            id INTEGER PRIMARY KEY AUTO_INCREMENT,
                            username TEXT NOT NULL,
                            type TEXT NOT NULL,
                            name TEXT NOT NULL,
                            weight REAL,
                            reps INTEGER,
                            score TEXT,
                            score_numeric REAL,
                            created_at TEXT NOT NULL
                        )
                    ''')
                    cursor.execute('''
                        INSERT INTO crossfit_entries (username, type, name, weight, reps, created_at)
                        VALUES (?, 'lift', ?, ?, ?, ?)
                    ''', (username, ex_name, float(weight), int(reps), date))
        except Exception as _e:
            pass
        
        print(f"Debug: Weight logged successfully for exercise {exercise_id}")
        
        conn.commit()
        conn.close()
        
        return jsonify({'success': True})
        
    except Exception as e:
        print(f"Debug: Error logging weight: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/edit_set', methods=['POST'])
@login_required
def edit_set():
    try:
        username = session.get('username')
        exercise_id = request.form.get('exercise_id')
        set_id = request.form.get('set_id')
        weight = request.form.get('weight')
        
        if not all([exercise_id, set_id, weight]):
            return jsonify({'success': False, 'error': 'All fields are required'})
        
        conn = sqlite3.connect('users.db')
        cursor = conn.cursor()
        
        # Verify the exercise belongs to the user
        cursor.execute('''
            SELECT id FROM exercises 
            WHERE id = ? AND username = ?
        ''', (exercise_id, username))
        
        if not cursor.fetchone():
            return jsonify({'success': False, 'error': 'Exercise not found'})
        
        # Update the set
        cursor.execute('''
            UPDATE exercise_sets 
            SET weight = ? 
            WHERE id = ? AND exercise_id = ?
        ''', (weight, set_id, exercise_id))
        
        conn.commit()
        conn.close()
        
        return jsonify({'success': True})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/delete_set', methods=['POST'])
@login_required
def delete_set():
    try:
        username = session.get('username')
        exercise_id = request.form.get('exercise_id')
        set_id = request.form.get('set_id')
        
        if not all([exercise_id, set_id]):
            return jsonify({'success': False, 'error': 'Exercise ID and set ID are required'})
        
        conn = sqlite3.connect('users.db')
        cursor = conn.cursor()
        
        # Verify the exercise belongs to the user
        cursor.execute('''
            SELECT id FROM exercises 
            WHERE id = ? AND username = ?
        ''', (exercise_id, username))
        
        if not cursor.fetchone():
            return jsonify({'success': False, 'error': 'Exercise not found'})
        
        # Delete the set
        cursor.execute('''
            DELETE FROM exercise_sets 
            WHERE id = ? AND exercise_id = ?
        ''', (set_id, exercise_id))
        
        conn.commit()
        conn.close()
        
        return jsonify({'success': True})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/delete_weight_entry', methods=['POST'])
@login_required
def delete_weight_entry():
    try:
        username = session.get('username')
        exercise_id = request.form.get('exercise_id')
        date = request.form.get('date')
        weight = request.form.get('weight')
        reps = request.form.get('reps')
        
        if not all([exercise_id, date, weight, reps]):
            return jsonify({'success': False, 'error': 'All fields are required'})
        
        conn = sqlite3.connect('users.db')
        cursor = conn.cursor()
        
        # Verify the exercise belongs to the user
        cursor.execute('''
            SELECT id FROM exercises 
            WHERE id = ? AND username = ?
        ''', (exercise_id, username))
        
        if not cursor.fetchone():
            return jsonify({'success': False, 'error': 'Exercise not found'})
        
        # Delete the specific weight entry
        cursor.execute('''
            DELETE FROM exercise_sets 
            WHERE exercise_id = ? AND weight = ? AND reps = ? AND created_at = ?
        ''', (exercise_id, weight, reps, date))
        
        deleted_count = cursor.rowcount
        conn.commit()
        conn.close()
        
        if deleted_count == 0:
            return jsonify({'success': False, 'error': 'Weight entry not found'})
        
        return jsonify({'success': True})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

def formatDate(date_string):
    """Format date for chart labels"""
    date = datetime.strptime(date_string, '%Y-%m-%d')
    return date.strftime('%b %d')
@app.route('/get_exercise_progress', methods=['GET'])
@login_required
def get_exercise_progress():
    try:
        username = session.get('username')
        exercise_id = request.args.get('exercise_id')
        time_range = request.args.get('time_range', 'all')
        
        if not exercise_id:
            return jsonify({'success': False, 'error': 'Exercise ID is required'})
        
        conn = sqlite3.connect('users.db')
        cursor = conn.cursor()
        
        # Build date filter
        date_filter = ""
        if time_range != 'all':
            date_filter = f"AND es.created_at >= DATE_SUB(NOW(), INTERVAL {time_range} DAY)"
        
        # Get weight entries for the exercise
        cursor.execute(f'''
            SELECT es.weight, es.reps, es.created_at
            FROM exercise_sets es
            JOIN exercises e ON es.exercise_id = e.id
            WHERE e.id = ? AND e.username = ? {date_filter}
            ORDER BY es.created_at ASC
        ''', (exercise_id, username))
        
        rows = cursor.fetchall()
        conn.close()
        
        if not rows:
            return jsonify({
                'success': True,
                'data': {
                    'labels': [],
                    'maxWeights': []
                }
            })
        
        # Process data for chart
        weight_data = {}
        for row in rows:
            weight, reps, date = row
            # Calculate 1RM using Epley formula
            one_rm = weight * (1 + reps / 30)
            
            if date not in weight_data:
                weight_data[date] = []
            weight_data[date].append(one_rm)
        
        # Get max 1RM for each date
        dates = sorted(weight_data.keys())
        labels = []
        max_weights = []
        
        for date in dates:
            max_1rm = max(weight_data[date])
            labels.append(formatDate(date))
            max_weights.append(round(max_1rm, 1))
        
        return jsonify({
            'success': True,
            'data': {
                'labels': labels,
                'maxWeights': max_weights
            }
        })
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/get_exercise_one_rm', methods=['GET'])
@login_required
def get_exercise_one_rm():
    try:
        username = session.get('username')
        exercise_id = request.args.get('exercise_id')
        
        if not exercise_id:
            return jsonify({'success': False, 'error': 'Exercise ID is required'})
        
        conn = sqlite3.connect('users.db')
        cursor = conn.cursor()
        
        # Get all weight entries for the exercise and calculate max 1RM
        cursor.execute('''
            SELECT es.weight, es.reps
            FROM exercise_sets es
            JOIN exercises e ON es.exercise_id = e.id
            WHERE e.id = ? AND e.username = ?
            ORDER BY es.created_at DESC
        ''', (exercise_id, username))
        
        rows = cursor.fetchall()
        conn.close()
        
        if not rows:
            return jsonify({'success': True, 'one_rm': 0})
        
        # Calculate 1RM for each entry and find the maximum
        max_one_rm = 0
        for row in rows:
            weight, reps = row
            one_rm = weight * (1 + reps / 30)  # Epley formula
            max_one_rm = max(max_one_rm, one_rm)
        
        return jsonify({'success': True, 'one_rm': round(max_one_rm, 1)})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/update_exercise_one_rm', methods=['POST'])
@login_required
def update_exercise_one_rm():
    try:
        username = session.get('username')
        exercise_id = request.form.get('exercise_id')
        weight = request.form.get('weight')
        reps = request.form.get('reps')
        
        if not all([exercise_id, weight, reps]):
            return jsonify({'success': False, 'error': 'All fields are required'})
        
        conn = sqlite3.connect('users.db')
        cursor = conn.cursor()
        
        # Verify the exercise belongs to the user
        cursor.execute('''
            SELECT id FROM exercises 
            WHERE id = ? AND username = ?
        ''', (exercise_id, username))
        
        if not cursor.fetchone():
            return jsonify({'success': False, 'error': 'Exercise not found'})
        
        # Add the new weight entry to exercise_sets
        cursor.execute('''
            INSERT INTO exercise_sets (exercise_id, weight, reps, created_at)
            VALUES (?, ?, ?, NOW())
        ''', (exercise_id, weight, reps))
        
        conn.commit()
        conn.close()
        
        return jsonify({'success': True})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/check_exercise_in_workout', methods=['GET'])
@login_required
def check_exercise_in_workout():
    try:
        username = session.get('username')
        workout_id = request.args.get('workout_id')
        exercise_id = request.args.get('exercise_id')
        
        if not all([workout_id, exercise_id]):
            return jsonify({'success': False, 'error': 'Workout ID and Exercise ID are required'})
        
        conn = sqlite3.connect('users.db')
        cursor = conn.cursor()
        
        # Check if the exercise is already in the workout and get its details
        cursor.execute('''
            SELECT we.id, we.weight, we.sets, we.reps, e.name
            FROM workout_exercises we
            JOIN workouts w ON we.workout_id = w.id
            JOIN exercises e ON we.exercise_id = e.id
            WHERE we.workout_id = ? AND we.exercise_id = ? AND w.username = ?
        ''', (workout_id, exercise_id, username))
        
        row = cursor.fetchone()
        conn.close()
        
        if row:
            return jsonify({
                'success': True, 
                'is_duplicate': True,
                'existing_exercise': {
                    'id': row[0],
                    'weight': row[1],
                    'sets': row[2],
                    'reps': row[3],
                    'name': row[4]
                }
            })
        else:
            return jsonify({'success': True, 'is_duplicate': False})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})
@app.route('/update_exercise_in_workout', methods=['POST'])
@login_required
def update_exercise_in_workout():
    try:
        username = session.get('username')
        workout_exercise_id = request.form.get('workout_exercise_id')
        weight = request.form.get('weight')
        sets = request.form.get('sets')
        reps = request.form.get('reps')
        
        if not all([workout_exercise_id, weight, sets, reps]):
            return jsonify({'success': False, 'error': 'All fields are required'})
        
        conn = sqlite3.connect('users.db')
        cursor = conn.cursor()
        
        # Verify the workout exercise belongs to the user
        cursor.execute('''
            SELECT we.id 
            FROM workout_exercises we
            JOIN workouts w ON we.workout_id = w.id
            WHERE we.id = ? AND w.username = ?
        ''', (workout_exercise_id, username))
        
        if not cursor.fetchone():
            return jsonify({'success': False, 'error': 'Workout exercise not found'})
        
        # Update the workout exercise
        cursor.execute('''
            UPDATE workout_exercises 
            SET weight = ?, sets = ?, reps = ?
            WHERE id = ?
        ''', (weight, sets, reps, workout_exercise_id))
        
        conn.commit()
        conn.close()
        
        return jsonify({'success': True})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/get_progress_summary', methods=['GET'])
@login_required
def get_progress_summary():
    try:
        username = session.get('username')
        exercise_id = request.args.get('exercise_id')
        time_range = request.args.get('time_range', 'all')
        
        if not exercise_id:
            return jsonify({'success': False, 'error': 'Exercise ID is required'})
        
        conn = sqlite3.connect('users.db')
        cursor = conn.cursor()
        
        # Get exercise name
        cursor.execute('SELECT name FROM exercises WHERE id = ? AND username = ?', (exercise_id, username))
        exercise = cursor.fetchone()
        if not exercise:
            return jsonify({'success': False, 'error': 'Exercise not found'})
        
        exercise_name = exercise[0]
        
        # Build date filter
        date_filter = ""
        if time_range != 'all':
            date_filter = f"AND created_at >= DATE_SUB(NOW(), INTERVAL {time_range} DAY)"
        
        # Get all weight entries for the exercise
        cursor.execute(f'''
            SELECT weight, reps, created_at
            FROM exercise_sets 
            WHERE exercise_id = ? {date_filter}
            ORDER BY created_at ASC
        ''', (exercise_id,))
        
        rows = cursor.fetchall()
        conn.close()
        
        if not rows:
            return jsonify({
                'success': True,
                'summary': {
                    'exercise_name': exercise_name,
                    'current_1rm': 0,
                    'progress_percentage': 0,
                    'total_sets': 0
                }
            })
        
        # Calculate 1RM for each entry
        one_rms = []
        for row in rows:
            weight, reps, date = row
            one_rm = weight * (1 + reps / 30)  # Epley formula
            one_rms.append(one_rm)
        
        current_1rm = max(one_rms)
        initial_1rm = one_rms[0] if one_rms else 0
        progress_percentage = ((current_1rm - initial_1rm) / initial_1rm * 100) if initial_1rm > 0 else 0
        
        return jsonify({
            'success': True,
            'summary': {
                'exercise_name': exercise_name,
                'current_1rm': round(current_1rm, 1),
                'progress_percentage': round(progress_percentage, 1),
                'total_sets': len(rows)
            }
        })
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/get_workout_summary', methods=['GET'])
@login_required
def get_workout_summary():
    try:
        username = session.get('username')
        
        conn = sqlite3.connect('users.db')
        cursor = conn.cursor()
        
        # Get total workouts
        cursor.execute('SELECT COUNT(*) FROM workouts WHERE username = ?', (username,))
        total_workouts = cursor.fetchone()[0]
        
        # Get workouts this week
        cursor.execute('''
            SELECT COUNT(*) FROM workouts 
            WHERE username = ? AND date >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        ''', (username,))
        workouts_this_week = cursor.fetchone()[0]
        
        # Get total exercises in workouts
        cursor.execute('''
            SELECT COUNT(*) FROM workout_exercises we
            JOIN workouts w ON we.workout_id = w.id
            WHERE w.username = ?
        ''', (username,))
        total_exercises = cursor.fetchone()[0]
        
        conn.close()
        
        return jsonify({
            'success': True,
            'summary': {
                'total_workouts': total_workouts,
                'workouts_this_week': workouts_this_week,
                'total_exercises': total_exercises
            }
        })
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})
@app.route('/share_progress', methods=['POST'])
@login_required
def share_progress():
    try:
        username = session.get('username')
        exercise_id = request.form.get('exercise_id')
        time_range = request.form.get('time_range')
        communities = request.form.getlist('communities')
        
        if not exercise_id or not communities:
            return jsonify({'success': False, 'error': 'Missing required fields'})
        
        conn = sqlite3.connect('users.db')
        cursor = conn.cursor()
        
        # Get exercise name
        cursor.execute('SELECT name FROM exercises WHERE id = ? AND username = ?', (exercise_id, username))
        exercise = cursor.fetchone()
        if not exercise:
            return jsonify({'success': False, 'error': 'Exercise not found'})
        
        exercise_name = exercise[0]
        
        # Get progress data
        date_filter = ""
        if time_range != 'all':
            date_filter = f"AND created_at >= DATE_SUB(NOW(), INTERVAL {time_range} DAY)"
        
        cursor.execute(f'''
            SELECT weight, reps, created_at
            FROM exercise_sets 
            WHERE exercise_id = ? {date_filter}
            ORDER BY created_at ASC
        ''', (exercise_id,))
        
        rows = cursor.fetchall()
        
        if not rows:
            return jsonify({'success': False, 'error': 'No progress data found'})
        
        # Calculate summary
        one_rms = [weight * (1 + reps / 30) for weight, reps, date in rows]
        current_1rm = max(one_rms)
        initial_1rm = one_rms[0]
        progress_percentage = ((current_1rm - initial_1rm) / initial_1rm * 100) if initial_1rm > 0 else 0
        
        # Get user message and graph image if provided
        user_message = request.form.get('user_message', '').strip()
        graph_image = request.form.get('graph_image', '').strip()
        
        # Create simple post content - just the exercise name if no user message
        if user_message:
            post_content = f"{user_message}"
        else:
            post_content = f"Progress Update: {exercise_name}"
        
        # Save graph image if provided
        image_path = None
        if graph_image and graph_image.startswith('data:image'):
            try:
                # Extract base64 data
                import base64
                image_data = graph_image.split(',')[1]
                image_bytes = base64.b64decode(image_data)
                
                # Generate filename
                import os
                from datetime import datetime
                timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
                filename = f"progress_graph_{username}_{exercise_id}_{timestamp}.png"
                filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
                
                # Save image
                with open(filepath, 'wb') as f:
                    f.write(image_bytes)
                
                image_path = f"uploads/{filename}"
                print(f"Debug: Saved graph image to {image_path}")
                
            except Exception as e:
                print(f"Debug: Error saving graph image: {e}")
                image_path = None
        
        # Share to each selected community
        for community_id in communities:
            cursor.execute('''
                INSERT INTO posts (username, community_id, content, image_path, timestamp)
                VALUES (?, ?, ?, ?, NOW())
            ''', (username, community_id, post_content, image_path))
        
        conn.commit()
        conn.close()
        
        return jsonify({'success': True})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/share_workouts', methods=['POST'])
@login_required
def share_workouts():
    try:
        username = session.get('username')
        communities = request.form.getlist('communities')
        
        if not communities:
            return jsonify({'success': False, 'error': 'No communities selected'})
        
        conn = sqlite3.connect('users.db')
        cursor = conn.cursor()
        
        # Get workout summary
        cursor.execute('SELECT COUNT(*) FROM workouts WHERE username = ?', (username,))
        total_workouts = cursor.fetchone()[0]
        
        cursor.execute('''
            SELECT COUNT(*) FROM workouts 
            WHERE username = ? AND date >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        ''', (username,))
        workouts_this_week = cursor.fetchone()[0]
        
        cursor.execute('''
            SELECT COUNT(*) FROM workout_exercises we
            JOIN workouts w ON we.workout_id = w.id
            WHERE w.username = ?
        ''', (username,))
        total_exercises = cursor.fetchone()[0]
        
        # Get user message if provided
        user_message = request.form.get('user_message', '').strip()
        
        # Create post content with proper spacing
        post_content = f"Workout Summary\n\n"
        post_content += f"Total workouts: {total_workouts}\n"
        post_content += f"This week: {workouts_this_week}\n"
        post_content += f"Total exercises: {total_exercises}"
        
        # Add user message if provided
        if user_message:
            post_content = f"{user_message}\n\n{post_content}"
        
        # Share to each selected community
        for community_id in communities:
            cursor.execute('''
                INSERT INTO posts (username, community_id, content, timestamp)
                VALUES (?, ?, ?, NOW())
            ''', (username, community_id, post_content))
        
        conn.commit()
        conn.close()
        
        return jsonify({'success': True})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/get_individual_workout_summary', methods=['GET'])
@login_required
def get_individual_workout_summary():
    try:
        username = session.get('username')
        workout_id = request.args.get('workout_id')
        
        if not workout_id:
            return jsonify({'success': False, 'error': 'Workout ID is required'})
        
        conn = sqlite3.connect('users.db')
        cursor = conn.cursor()
        
        # Get workout details
        cursor.execute('''
            SELECT w.name, w.date, COUNT(we.id) as exercise_count, SUM(we.sets) as total_sets
            FROM workouts w
            LEFT JOIN workout_exercises we ON w.id = we.workout_id
            WHERE w.id = ? AND w.username = ?
            GROUP BY w.id
        ''', (workout_id, username))
        
        row = cursor.fetchone()
        conn.close()
        
        if not row:
            return jsonify({'success': False, 'error': 'Workout not found'})
        
        name, date, exercise_count, total_sets = row
        
        return jsonify({
            'success': True,
            'summary': {
                'name': name,
                'date': date,
                'exercise_count': exercise_count or 0,
                'total_sets': total_sets or 0
            }
        })
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})
@app.route('/share_individual_workout', methods=['POST'])
@login_required
def share_individual_workout():
    print("=== SHARE INDIVIDUAL WORKOUT DEBUG ===")
    print(f"Form data: {request.form}")
    print(f"Form keys: {list(request.form.keys())}")
    
    try:
        username = session.get('username')
        workout_id = request.form.get('workout_id')
        communities = request.form.getlist('communities')
        
        print(f"Username: {username}")
        print(f"Workout ID: {workout_id}")
        print(f"Communities: {communities}")
        
        if not workout_id:
            return jsonify({'success': False, 'error': 'Workout ID is required'})
        
        if not communities:
            return jsonify({'success': False, 'error': 'No communities selected'})
        
        conn = sqlite3.connect('users.db')
        cursor = conn.cursor()
        
        # Get workout details
        cursor.execute('''
            SELECT w.name, w.date, COUNT(we.id) as exercise_count, 
                   GROUP_CONCAT(e.name || ' (' || we.weight || 'kg x ' || we.sets || ' sets x ' || we.reps || ' reps)') as exercises
            FROM workouts w
            LEFT JOIN workout_exercises we ON w.id = we.workout_id
            LEFT JOIN exercises e ON we.exercise_id = e.id
            WHERE w.id = ? AND w.username = ?
            GROUP BY w.id
        ''', (workout_id, username))
        
        row = cursor.fetchone()
        if not row:
            conn.close()
            return jsonify({'success': False, 'error': 'Workout not found'})
        
        name, date, exercise_count, exercises = row
        
        print(f"Debug: Raw data from database:")
        print(f"  name = '{name}'")
        print(f"  date = '{date}'")
        print(f"  exercise_count = {exercise_count}")
        print(f"  exercises = '{exercises}'")
        
        # Get user message if provided
        user_message = request.form.get('user_message', '').strip()
        print(f"Debug: user_message = '{user_message}'")
        
        # Create post content with clean format
        # Extract just the workout name (remove any date or extra parts)
        workout_name = name
        if ' - ' in name:
            workout_name = name.split(' - ')[0]
        elif ' Push Day' in name:
            workout_name = name.split(' Push Day')[0]
        
        print(f"Debug: Original name = '{name}'")
        print(f"Debug: Cleaned workout_name = '{workout_name}'")
        
        content = f"{workout_name}\n\n"
        content += f"{date}\n"
        
        if exercises:
            exercise_list = exercises.split(',')
            for exercise in exercise_list:
                # Clean up the exercise format
                exercise_clean = exercise.strip()
                if '(' in exercise_clean:
                    exercise_name = exercise_clean.split(' (')[0].strip()
                    exercise_details = exercise_clean.split('(')[1].split(')')[0].strip()
                    content += f"{exercise_name} ({exercise_details})\n"
                else:
                    content += f"{exercise_clean}\n"
        
        # Add user message if provided
        if user_message:
            content = f"{user_message}\n\n{content}"
        
        print(f"Debug: Final workout content = '{content}'")
        print(f"Debug: Content length = {len(content)}")
        print(f"Debug: Content lines = {content.split(chr(10))}")
        
        # Share to each selected community
        for community_id in communities:
            cursor.execute('''
                INSERT INTO posts (username, community_id, content, timestamp)
                VALUES (?, ?, ?, NOW())
            ''', (username, community_id, content))
        
        conn.commit()
        conn.close()
        
        return jsonify({'success': True})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

# Workout Management Routes
@app.route('/create_workout', methods=['POST'])
def create_workout():
    print(f"Debug: create_workout called")
    print(f"Debug: session username: {session.get('username')}")
    print(f"Debug: form data: {request.form}")
    
    if 'username' not in session:
        print(f"Debug: User not logged in")
        return jsonify({'success': False, 'error': 'Not logged in'})
    
    try:
        name = request.form.get('name')
        date = request.form.get('date')
        
        print(f"Debug: name={name}, date={date}")
        
        if not name or not date:
            print(f"Debug: Missing required fields")
            return jsonify({'success': False, 'error': 'Missing required fields'})
        
        conn = sqlite3.connect('users.db')
        cursor = conn.cursor()
        
        # Create workouts table if it doesn't exist
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS workouts (
                id INTEGER PRIMARY KEY AUTO_INCREMENT,
                username TEXT NOT NULL,
                name TEXT NOT NULL,
                date TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # Insert workout
        cursor.execute('''
            INSERT INTO workouts (username, name, date)
            VALUES (?, ?, ?)
        ''', (session['username'], name, date))
        
        conn.commit()
        conn.close()
        
        return jsonify({'success': True})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/get_workouts', methods=['GET'])
def get_workouts():
    if 'username' not in session:
        return jsonify({'success': False, 'error': 'Not logged in'})
    
    try:
        conn = sqlite3.connect('users.db')
        cursor = conn.cursor()
        
        # Get workouts
        cursor.execute('''
            SELECT w.id, w.name, w.date, w.created_at,
                   COUNT(we.id) as exercise_count
            FROM workouts w
            LEFT JOIN workout_exercises we ON w.id = we.workout_id
            WHERE w.username = ?
            GROUP BY w.id
            ORDER BY w.date DESC
        ''', (session['username'],))
        
        workouts = []
        for row in cursor.fetchall():
            workout = {
                'id': row[0],
                'name': row[1],
                'date': row[2],
                'created_at': row[3],
                'exercise_count': row[4]
            }
            workouts.append(workout)
        
        conn.close()
        return jsonify({'success': True, 'workouts': workouts})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/get_workout_details', methods=['GET'])
def get_workout_details():
    if 'username' not in session:
        return jsonify({'success': False, 'error': 'Not logged in'})
    
    try:
        workout_id = request.args.get('workout_id')
        if not workout_id:
            return jsonify({'success': False, 'error': 'Missing workout ID'})
        
        conn = sqlite3.connect('users.db')
        cursor = conn.cursor()
        
        # Get workout details
        cursor.execute('''
            SELECT w.id, w.name, w.date, w.created_at
            FROM workouts w
            WHERE w.id = ? AND w.username = ?
        ''', (workout_id, session['username']))
        
        workout_row = cursor.fetchone()
        if not workout_row:
            return jsonify({'success': False, 'error': 'Workout not found'})
        
        workout = {
            'id': workout_row[0],
            'name': workout_row[1],
            'date': workout_row[2],
            'created_at': workout_row[3],
            'exercises': []
        }
        
        # Get workout exercises
        cursor.execute('''
            SELECT we.id, we.weight, we.sets, we.reps, e.name as exercise_name, e.muscle_group
            FROM workout_exercises we
            JOIN exercises e ON we.exercise_id = e.id
            WHERE we.workout_id = ?
            ORDER BY we.id
        ''', (workout_id,))
        
        for row in cursor.fetchall():
            exercise = {
                'id': row[0],
                'weight': row[1],
                'sets': row[2],
                'reps': row[3],
                'exercise_name': row[4],
                'muscle_group': row[5]
            }
            workout['exercises'].append(exercise)
        
        conn.close()
        return jsonify({'success': True, 'workout': workout})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/add_exercise_to_workout', methods=['POST'])
def add_exercise_to_workout():
    if 'username' not in session:
        return jsonify({'success': False, 'error': 'Not logged in'})
    
    try:
        workout_id = request.form.get('workout_id')
        exercise_id = request.form.get('exercise_id')
        weight = request.form.get('weight')
        sets = request.form.get('sets')
        reps = request.form.get('reps')
        
        print(f"Debug: Adding exercise to workout - workout_id: {workout_id}, exercise_id: {exercise_id}, weight: {weight}, sets: {sets}, reps: {reps}")
        
        if not all([workout_id, exercise_id, weight, sets, reps]):
            return jsonify({'success': False, 'error': 'Missing required fields'})
        
        conn = sqlite3.connect('users.db')
        cursor = conn.cursor()
        
        # Verify workout belongs to user
        cursor.execute('''
            SELECT id FROM workouts 
            WHERE id = ? AND username = ?
        ''', (workout_id, session['username']))
        
        if not cursor.fetchone():
            return jsonify({'success': False, 'error': 'Workout not found'})
        
        # Add exercise to workout
        cursor.execute('''
            INSERT INTO workout_exercises (workout_id, exercise_id, weight, sets, reps)
            VALUES (?, ?, ?, ?, ?)
        ''', (workout_id, exercise_id, weight, sets, reps))
        
        conn.commit()
        conn.close()
        
        return jsonify({'success': True})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/remove_exercise_from_workout', methods=['POST'])
def remove_exercise_from_workout():
    if 'username' not in session:
        return jsonify({'success': False, 'error': 'Not logged in'})
    
    try:
        workout_exercise_id = request.form.get('workout_exercise_id')
        
        if not workout_exercise_id:
            return jsonify({'success': False, 'error': 'Missing workout exercise ID'})
        
        print(f"Debug: Removing workout exercise ID: {workout_exercise_id}")
        
        conn = sqlite3.connect('users.db')
        cursor = conn.cursor()
        
        # Verify workout exercise belongs to user
        cursor.execute('''
            SELECT we.id FROM workout_exercises we
            JOIN workouts w ON we.workout_id = w.id
            WHERE we.id = ? AND w.username = ?
        ''', (workout_exercise_id, session['username']))
        
        if not cursor.fetchone():
            return jsonify({'success': False, 'error': 'Workout exercise not found'})
        
        # Remove exercise from workout
        cursor.execute('DELETE FROM workout_exercises WHERE id = ?', (workout_exercise_id,))
        
        print(f"Debug: Removed workout exercise ID: {workout_exercise_id}")
        
        conn.commit()
        conn.close()
        
        return jsonify({'success': True})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/delete_workout', methods=['POST'])
def delete_workout():
    if 'username' not in session:
        return jsonify({'success': False, 'error': 'Not logged in'})
    
    try:
        workout_id = request.form.get('workout_id')
        
        if not workout_id:
            return jsonify({'success': False, 'error': 'Missing workout ID'})
        
        conn = sqlite3.connect('users.db')
        cursor = conn.cursor()
        
        # Verify workout belongs to user
        cursor.execute('''
            SELECT id FROM workouts 
            WHERE id = ? AND username = ?
        ''', (workout_id, session['username']))
        
        if not cursor.fetchone():
            return jsonify({'success': False, 'error': 'Workout not found'})
        
        # Delete workout exercises first (due to foreign key)
        cursor.execute('DELETE FROM workout_exercises WHERE workout_id = ?', (workout_id,))
        
        # Delete workout
        cursor.execute('DELETE FROM workouts WHERE id = ?', (workout_id,))
        
        conn.commit()
        conn.close()
        
        return jsonify({'success': True})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/get_user_exercises', methods=['GET'])
@login_required
def get_user_exercises():
    try:
        username = session.get('username')
        
        conn = sqlite3.connect('users.db')
        cursor = conn.cursor()
        
        # Get all exercises with their weight history
        cursor.execute('''
            SELECT e.id, e.name, e.muscle_group,
                   es.weight, es.reps, es.created_at
            FROM exercises e
            LEFT JOIN exercise_sets es ON e.id = es.exercise_id
            WHERE e.username = ?
            ORDER BY e.muscle_group, e.name, es.created_at DESC
        ''', (username,))
        
        rows = cursor.fetchall()
        conn.close()
        
        # Group exercises with their weight history
        exercises = []
        current_exercise = None
        
        for row in rows:
            exercise_id = row[0]
            exercise_name = row[1]
            muscle_group = row[2]
            
            # If this is a new exercise
            if not current_exercise or current_exercise['id'] != exercise_id:
                current_exercise = {
                    'id': exercise_id,
                    'name': exercise_name,
                    'muscle_group': muscle_group,
                    'weight_history': []
                }
                exercises.append(current_exercise)
            
            # Add weight data if it exists
            if row[3]:  # If there's weight data
                current_exercise['weight_history'].append({
                    'weight': row[3],
                    'reps': row[4],
                    'date': row[5]
                })
        
        print(f"Debug: Found {len(exercises)} exercises for user {username}")
        for exercise in exercises:
            print(f"Debug: Exercise '{exercise['name']}' has {len(exercise['weight_history'])} weight entries")
            if exercise['weight_history']:
                print(f"Debug: Weight entries: {exercise['weight_history']}")
        
        return jsonify({'success': True, 'exercises': exercises})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})





@app.route('/test_version')
def test_version():
    return jsonify({'version': '1755799276', 'message': 'Updated version loaded with format fix'})
@app.route('/test_database')
def test_database():
    try:
        conn = sqlite3.connect('users.db')
        cursor = conn.cursor()
        
        # Check if tables exist
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = cursor.fetchall()
        
        # Check exercises table
        cursor.execute("SELECT COUNT(*) FROM exercises")
        exercise_count = cursor.fetchone()[0]
        
        # Check workouts table
        cursor.execute("SELECT COUNT(*) FROM workouts")
        workout_count = cursor.fetchone()[0]
        
        # Check exercise_sets table
        cursor.execute("SELECT COUNT(*) FROM exercise_sets")
        sets_count = cursor.fetchone()[0]
        
        # Check communities table structure
        cursor.execute("SHOW COLUMNS FROM communities")
        community_columns = cursor.fetchall()
        
        # Check if required columns exist
        column_names = [col['Field'] for col in community_columns]
        missing_columns = []
        if 'info' not in column_names:
            missing_columns.append('info')
        if 'info_updated_at' not in column_names:
            missing_columns.append('info_updated_at')
        
        # Check community_announcements table
        announcements_count = 0
        try:
            cursor.execute("SELECT COUNT(*) FROM community_announcements")
            announcements_count = cursor.fetchone()[0]
        except:
            pass
        
        # Check community_files table
        files_count = 0
        try:
            cursor.execute("SELECT COUNT(*) FROM community_files")
            files_count = cursor.fetchone()[0]
        except:
            pass
        
        conn.close()
        
        return jsonify({
            'tables': [table[0] for table in tables],
            'exercise_count': exercise_count,
            'workout_count': workout_count,
            'sets_count': sets_count,
            'community_columns': column_names,
            'missing_columns': missing_columns,
            'needs_fix': len(missing_columns) > 0,
            'announcements_count': announcements_count,
            'files_count': files_count
        })
        
    except Exception as e:
        return jsonify({'error': str(e)})

@app.route('/fix_communities_table')
def fix_communities_table():
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Check if info column exists
        cursor.execute("SHOW COLUMNS FROM communities")
        columns = [col['Field'] for col in cursor.fetchall()]
        
        changes_made = []
        
        if 'info' not in columns:
            logger.info("Adding info column to communities table...")
            cursor.execute("ALTER TABLE communities ADD COLUMN info TEXT")
            changes_made.append('info column added')
        
        if 'info_updated_at' not in columns:
            logger.info("Adding info_updated_at column to communities table...")
            cursor.execute("ALTER TABLE communities ADD COLUMN info_updated_at TEXT")
            changes_made.append('info_updated_at column added')
        
        conn.commit()
        conn.close()
        
        if changes_made:
            return jsonify({'success': True, 'message': f'Database updated: {", ".join(changes_made)}'})
        else:
            return jsonify({'success': True, 'message': 'All columns already exist'})
        
    except Exception as e:
        logger.error(f"Error fixing communities table: {e}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/test_format')
def test_format():
    # Simulate the format generation
    workout_name = "Wod v3 Push Day"
    date = "2025-08-21"
    
    # Extract clean workout name
    clean_name = workout_name
    if ' - ' in workout_name:
        clean_name = workout_name.split(' - ')[0]
    elif ' Push Day' in workout_name:
        clean_name = workout_name.split(' Push Day')[0]
    
    content = f"{clean_name}\n\n"
    content += f"{date}\n"
    content += "Hack Squat (40.0kg x 2 sets x 12 reps)\n"
    content += "Bench Press (150.0kg x 1 sets x 1 reps)\n"
    
    return jsonify({
        'original_name': workout_name,
        'clean_name': clean_name,
        'date': date,
        'final_content': content,
        'content_lines': content.split('\n')
    })

@app.route('/test_community_template')
def test_community_template():
    """Test route to check if community template renders correctly"""
    try:
        # Create a mock community object
        mock_community = {
            'id': 1,
            'name': 'Test Community',
            'type': 'Test',
            'creator_username': 'admin',
            'join_code': 'TEST123',
            'created_at': '2025-01-01',
            'description': 'Test description',
            'location': 'Test location',
            'background_path': '',
            'info': 'Test announcement\nWith multiple lines',
            'info_updated_at': '2025-01-01 12:00:00',
            'template': 'default',
            'background_color': '#2d3839',
            'text_color': '#ffffff',
            'accent_color': '#4db6ac',
            'card_color': '#1a2526'
        }
        
        return render_template('community_feed.html', 
                            posts=[], 
                            community=mock_community,
                            username='admin')
    except Exception as e:
        import traceback
        return jsonify({
            'success': False, 
            'error': str(e), 
            'traceback': traceback.format_exc()
        })

@app.route('/simple_test')
def simple_test():
    """Simple test route without any decorators"""
    return jsonify({'success': True, 'message': 'Simple test route works'})
# Community Announcements Routes
@app.route('/save_community_info', methods=['POST'])
def save_community_info():
    try:
        if 'username' not in session:
            return jsonify({'success': False, 'error': 'Not logged in'})
        
        community_id = request.form.get('community_id')
        info = request.form.get('info', '')
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Check if user is admin or community creator
        cursor.execute('''
            SELECT creator_username FROM communities 
            WHERE id = ?
        ''', (community_id,))
        
        community = cursor.fetchone()
        if not community:
            return jsonify({'success': False, 'error': 'Community not found'})
        
        if session['username'] != community['creator_username'] and session['username'] != 'admin':
            return jsonify({'success': False, 'error': 'Unauthorized'})
        
        # Save announcement to announcements table
        cursor.execute('''
            INSERT INTO community_announcements 
            (community_id, content, created_by, created_at)
            VALUES (?, ?, ?, ?)
        ''', (community_id, info, session['username'], datetime.now().strftime('%Y-%m-%d %H:%M:%S')))
        
        # Update community info to show latest announcement
        cursor.execute('''
            UPDATE communities 
            SET info = ?, info_updated_at = ? 
            WHERE id = ?
        ''', (info, datetime.now().strftime('%Y-%m-%d %H:%M:%S'), community_id))
        
        conn.commit()
        conn.close()
        
        return jsonify({'success': True})
        
    except Exception as e:
        logger.error(f"Error saving community info: {e}")
        return jsonify({'success': False, 'error': str(e)})
@app.route('/upload_community_files', methods=['POST'])
def upload_community_files():
    try:
        if 'username' not in session:
            return jsonify({'success': False, 'error': 'Not logged in'})
        
        community_id = request.form.get('community_id')
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Check if user is admin or community creator
        cursor.execute('''
            SELECT creator_username FROM communities 
            WHERE id = ?
        ''', (community_id,))
        
        community = cursor.fetchone()
        if not community:
            return jsonify({'success': False, 'error': 'Community not found'})
        
        if session['username'] != community['creator_username'] and session['username'] != 'admin':
            return jsonify({'success': False, 'error': 'Unauthorized'})
        
        # Create community files directory
        community_files_dir = os.path.join('static', 'community_files', str(community_id))
        os.makedirs(community_files_dir, exist_ok=True)
        
        uploaded_files = []
        files = request.files.getlist('files')
        
        for file in files:
            if file and file.filename:
                filename = secure_filename(file.filename)
                file_path = os.path.join(community_files_dir, filename)
                file.save(file_path)
                
                # Get file description
                description = request.form.get('description', '')
                
                # Save file info to database
                cursor.execute('''
                    INSERT INTO community_files (community_id, filename, uploaded_by, upload_date, description)
                    VALUES (?, ?, ?, ?, ?)
                ''', (community_id, filename, session['username'], datetime.now().strftime('%Y-%m-%d %H:%M:%S'), description))
                
                uploaded_files.append(filename)
        
        conn.commit()
        conn.close()
        
        return jsonify({'success': True, 'files': uploaded_files})
        
    except Exception as e:
        logger.error(f"Error uploading community files: {e}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/get_community_files', methods=['GET'])
def get_community_files():
    try:
        community_id = request.args.get('community_id')
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT filename, uploaded_by, upload_date, description 
            FROM community_files 
            WHERE community_id = ?
            ORDER BY upload_date DESC
        ''', (community_id,))
        
        files = []
        for row in cursor.fetchall():
            files.append({
                'filename': row['filename'],
                'uploaded_by': row['uploaded_by'],
                'upload_date': row['upload_date'],
                'description': row['description'] or ''
            })
        
        conn.close()
        
        return jsonify({'success': True, 'files': files})
        
    except Exception as e:
        logger.error(f"Error getting community files: {e}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/download_community_file/<filename>')
def download_community_file(filename):
    try:
        community_id = request.args.get('community_id')
        
        if not community_id:
            return jsonify({'success': False, 'error': 'Community ID required'})
        
        file_path = os.path.join('static', 'community_files', str(community_id), filename)
        
        if not os.path.exists(file_path):
            return jsonify({'success': False, 'error': 'File not found'})
        
        return send_from_directory(os.path.dirname(file_path), filename)
        
    except Exception as e:
        logger.error(f"Error downloading community file: {e}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/delete_community_file', methods=['POST'])
def delete_community_file():
    try:
        if 'username' not in session:
            return jsonify({'success': False, 'error': 'Not logged in'})
        
        community_id = request.form.get('community_id')
        file_id = request.form.get('file_id')
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Check if user is admin or community creator
        cursor.execute('''
            SELECT creator_username FROM communities 
            WHERE id = ?
        ''', (community_id,))
        
        community = cursor.fetchone()
        if not community:
            return jsonify({'success': False, 'error': 'Community not found'})
        
        if session['username'] != community['creator_username'] and session['username'] != 'admin':
            return jsonify({'success': False, 'error': 'Unauthorized'})
        
        # Get file info first
        cursor.execute('''
            SELECT filename, file_path FROM community_files 
            WHERE id = ? AND community_id = ?
        ''', (file_id, community_id))
        
        file_data = cursor.fetchone()
        if not file_data:
            return jsonify({'success': False, 'error': 'File not found'})
        
        # Delete file from filesystem
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], file_data['file_path'])
        if os.path.exists(file_path):
            os.remove(file_path)
        
        # Delete file record from database
        cursor.execute('''
            DELETE FROM community_files 
            WHERE id = ? AND community_id = ?
        ''', (file_id, community_id))
        
        conn.commit()
        conn.close()
        
        return jsonify({'success': True})
        
    except Exception as e:
        logger.error(f"Error deleting community file: {e}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/save_community_announcement', methods=['POST'])
def save_community_announcement():
    try:
        if 'username' not in session:
            return jsonify({'success': False, 'error': 'Not logged in'})
        
        content = request.form.get('content')
        community_id = request.form.get('community_id')
        
        if not content or not community_id:
            return jsonify({'success': False, 'error': 'Missing required fields'})
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Create tables if they don't exist
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS community_announcements (
                id INTEGER PRIMARY KEY AUTO_INCREMENT,
                community_id INTEGER NOT NULL,
                content TEXT NOT NULL,
                created_by TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        ''')
        
        # Drop and recreate community_files table with correct structure
        cursor.execute("DROP TABLE IF EXISTS community_files")
        cursor.execute('''
            CREATE TABLE community_files (
                id INTEGER PRIMARY KEY AUTO_INCREMENT,
                announcement_id INTEGER NOT NULL,
                community_id INTEGER NOT NULL,
                filename TEXT NOT NULL,
                file_path TEXT NOT NULL,
                uploaded_by TEXT NOT NULL,
                uploaded_at TEXT NOT NULL,
                upload_date TEXT NOT NULL,
                FOREIGN KEY (announcement_id) REFERENCES community_announcements (id) ON DELETE CASCADE
            )
        ''')
        
        # Check if user is admin or community creator
        cursor.execute('''
            SELECT creator_username FROM communities 
            WHERE id = ?
        ''', (community_id,))
        
        community = cursor.fetchone()
        if not community:
            return jsonify({'success': False, 'error': 'Community not found'})
        
        if session['username'] != community['creator_username'] and session['username'] != 'admin':
            return jsonify({'success': False, 'error': 'Unauthorized'})
        
        # Save announcement to database
        cursor.execute('''
            INSERT INTO community_announcements (community_id, content, created_by, created_at)
            VALUES (?, ?, ?, ?)
        ''', (community_id, content, session['username'], datetime.now().strftime('%m.%d.%y %H:%M')))
        
        announcement_id = cursor.lastrowid
        
        # Handle file uploads
        files = request.files.getlist('files')
        uploaded_files = []
        
        for file in files:
            if file and file.filename:
                # Create unique filename
                filename = secure_filename(file.filename)
                timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
                unique_filename = f"{timestamp}_{filename}"
                
                # Save file to uploads directory
                file_path = os.path.join(app.config['UPLOAD_FOLDER'], unique_filename)
                file.save(file_path)
                
                # Save file info to database
                cursor.execute('''
                    INSERT INTO community_files (announcement_id, community_id, filename, file_path, uploaded_by, uploaded_at, upload_date)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                ''', (announcement_id, community_id, filename, unique_filename, session['username'], datetime.now().strftime('%m.%d.%y %H:%M'), datetime.now().strftime('%m.%d.%y %H:%M')))
                
                uploaded_files.append({
                    'filename': filename,
                    'file_path': unique_filename
                })
        
        # Update community info to show the latest announcement
        cursor.execute('''
            UPDATE communities 
            SET info = ?, info_updated_at = ? 
            WHERE id = ?
        ''', (content, datetime.now().strftime('%m.%d.%y %H:%M'), community_id))
        
        conn.commit()
        conn.close()
        
        return jsonify({'success': True, 'files': uploaded_files})
        
    except Exception as e:
        logger.error(f"Error saving community announcement: {e}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/get_community_announcements', methods=['GET'])
def get_community_announcements():
    try:
        community_id = request.args.get('community_id')
        logger.info(f"Getting announcements for community_id: {community_id}")
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT id, content, created_by, created_at 
            FROM community_announcements 
            WHERE community_id = ?
            ORDER BY created_at DESC
        ''', (community_id,))
        
        rows = cursor.fetchall()
        logger.info(f"Found {len(rows)} announcements for community {community_id}")
        
        announcements = []
        for row in rows:
            # Get files for this announcement
            cursor.execute('''
                SELECT id, filename, file_path, uploaded_by, uploaded_at
                FROM community_files 
                WHERE announcement_id = ?
                ORDER BY uploaded_at DESC
            ''', (row['id'],))
            
            files = []
            for file_row in cursor.fetchall():
                files.append({
                    'id': file_row['id'],
                    'filename': file_row['filename'],
                    'file_path': file_row['file_path'],
                    'uploaded_by': file_row['uploaded_by'],
                    'uploaded_at': file_row['uploaded_at']
                })
            
            announcements.append({
                'id': row['id'],
                'content': row['content'],
                'created_by': row['created_by'],
                'created_at': row['created_at'],
                'files': files
            })
        
        conn.close()
        
        return jsonify({'success': True, 'announcements': announcements})
        
    except Exception as e:
        logger.error(f"Error getting community announcements: {e}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/delete_community_announcement', methods=['POST'])
def delete_community_announcement():
    try:
        if 'username' not in session:
            return jsonify({'success': False, 'error': 'Not logged in'})
        
        announcement_id = request.form.get('announcement_id')
        community_id = request.form.get('community_id')
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Check if user is admin or community creator
        cursor.execute('''
            SELECT creator_username FROM communities 
            WHERE id = ?
        ''', (community_id,))
        
        community = cursor.fetchone()
        if not community:
            return jsonify({'success': False, 'error': 'Community not found'})
        
        if session['username'] != community['creator_username'] and session['username'] != 'admin':
            return jsonify({'success': False, 'error': 'Unauthorized'})
        
        # Delete announcement from database
        cursor.execute('''
            DELETE FROM community_announcements 
            WHERE id = ? AND community_id = ?
        ''', (announcement_id, community_id))
        
        # Update community info to show the next latest announcement
        cursor.execute('''
            SELECT content, created_at FROM community_announcements 
            WHERE community_id = ? 
            ORDER BY created_at DESC 
            LIMIT 1
        ''', (community_id,))
        
        latest = cursor.fetchone()
        if latest:
            cursor.execute('''
                UPDATE communities 
                SET info = ?, info_updated_at = ? 
                WHERE id = ?
            ''', (latest['content'], latest['created_at'], community_id))
        else:
            cursor.execute('''
                UPDATE communities 
                SET info = NULL, info_updated_at = NULL 
                WHERE id = ?
            ''', (community_id,))
        
        conn.commit()
        conn.close()
        
        return jsonify({'success': True})
        
    except Exception as e:
        logger.error(f"Error deleting community announcement: {e}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/download_announcement_file/<int:file_id>')
def download_announcement_file(file_id):
    """Download a community file"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT filename, file_path FROM community_files 
            WHERE id = ?
        ''', (file_id,))
        
        file_data = cursor.fetchone()
        logger.info(f"File data for ID {file_id}: {file_data}")
        conn.close()
        
        if not file_data:
            return "File not found", 404
        
        if not file_data['file_path']:
            return "File path not found", 404
            
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], file_data['file_path'])
        
        if not os.path.exists(file_path):
            return "File not found", 404
        
        return send_from_directory(app.config['UPLOAD_FOLDER'], file_data['file_path'], as_attachment=True, download_name=file_data['filename'])
        
    except Exception as e:
        logger.error(f"Error downloading community file: {e}")
        return "Error downloading file", 500

@app.route('/debug_table_structure')
def debug_table_structure():
    """Debug route to check table structure"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Check community_files table structure
        cursor.execute("SHOW COLUMNS FROM community_files")
        columns = cursor.fetchall()
        
        conn.close()
        
        return jsonify({
            'success': True,
            'community_files_columns': [{'name': col[1], 'type': col[2], 'notnull': col[3]} for col in columns]
        })
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/cleanup_missing_images')
@login_required
def cleanup_missing_images():
    """Clean up database references to missing image files"""
    if session.get('username') != 'admin':
        return "Access denied", 403
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Get all posts with image_path
            c.execute("SELECT id, image_path FROM posts WHERE image_path IS NOT NULL AND image_path != '' AND image_path != 'None'")
            posts = c.fetchall()
            
            cleaned_count = 0
            for post in posts:
                image_path = post['image_path']
                # Clean the path
                clean_path = image_path.replace('uploads/uploads/', '').replace('uploads/', '')
                full_path = os.path.join(app.config['UPLOAD_FOLDER'], clean_path)
                
                # Check if file exists
                if not os.path.exists(full_path):
                    logger.info(f"Cleaning missing image reference: {image_path} for post {post['id']}")
                    c.execute("UPDATE posts SET image_path = NULL WHERE id = ?", (post['id'],))
                    cleaned_count += 1
            
            conn.commit()
            return jsonify({
                'success': True,
                'message': f'Cleaned {cleaned_count} missing image references',
                'cleaned_count': cleaned_count
            })
            
    except Exception as e:
        logger.error(f"Error cleaning missing images: {str(e)}")
        return jsonify({'success': False, 'error': str(e)})
@app.route('/seed_dummy_data', methods=['POST'])
@login_required
def seed_dummy_data():
    try:
        # Only allow admin to seed
        username = session.get('username')
        if username != 'admin':
            return jsonify({'success': False, 'error': 'Unauthorized'}), 403

        import random
        from datetime import datetime, timedelta

        with get_db_connection() as conn:
            c = conn.cursor()

            # Ensure crossfit_entries table exists
            c.execute('''CREATE TABLE IF NOT EXISTS crossfit_entries (
                id INTEGER PRIMARY KEY AUTO_INCREMENT,
                username TEXT NOT NULL,
                type TEXT NOT NULL,
                name TEXT NOT NULL,
                weight REAL,
                reps INTEGER,
                score TEXT,
                score_numeric REAL,
                created_at TEXT NOT NULL
            )''')

            # Create or get Gym and Crossfit communities
            def get_or_create_community(name, ctype):
                c.execute('SELECT id FROM communities WHERE name=? AND type=?', (name, ctype))
                r = c.fetchone()
                if r:
                    return r['id'] if isinstance(r, sqlite3.Row) else r[0]
                join_code = generate_join_code()
                c.execute('''INSERT INTO communities (name, type, creator_username, join_code, created_at)
                             VALUES (?, ?, ?, ?, ?)''', (name, ctype, 'admin', join_code, datetime.now().strftime('%m.%d.%y %H:%M')))
                return c.lastrowid

            gym_comm_id = get_or_create_community('Demo Gym', 'gym')
            cf_comm_id = get_or_create_community('Demo Crossfit Box', 'crossfit')

            # Helper to get or create user and map to communities
            def ensure_user(u):
                c.execute('SELECT rowid FROM users WHERE username=?', (u,))
                row = c.fetchone()
                if not row:
                    c.execute('''INSERT INTO users (username, email, password, created_at)
                                 VALUES (?, ?, ?, ?)''', (u, f'{u}@example.com', '12345', datetime.now().strftime('%m.%d.%y %H:%M')))
                    c.execute('SELECT rowid FROM users WHERE username=?', (u,))
                    row = c.fetchone()
                user_id = row['rowid'] if isinstance(row, sqlite3.Row) else row[0]
                # Add to communities if not already
                for comm_id in (gym_comm_id, cf_comm_id):
                    c.execute('SELECT 1 FROM user_communities WHERE user_id=? AND community_id=?', (user_id, comm_id))
                    if not c.fetchone():
                        c.execute('INSERT INTO user_communities (user_id, community_id, joined_at) VALUES (?, ?, ?)', (user_id, comm_id, datetime.now().strftime('%Y-%m-%d %H:%M:%S')))

            # Generate 20 users
            users = [f'user{i:02d}' for i in range(1, 21)]
            for u in users:
                ensure_user(u)

            # Gym seed data: a few common exercises
            gym_exercises = [
                ('Bench Press', 'Chest'),
                ('Back Squat', 'Legs'),
                ('Deadlift', 'Back'),
                ('Overhead Press', 'Shoulders')
            ]

            # Crossfit lists (subset)
            cf_lifts = ['Back Squat','Deadlift','Clean','Snatch','Thruster']
            cf_wods = ['Fran','Cindy','Helen','Grace','Isabel']

            # 6-month timeline (roughly every 7 days)
            today = datetime.now().date()
            start_date = today - timedelta(days=180)
            dates = [start_date + timedelta(days=7*i) for i in range(27)]

            # Seed gym exercises/sets
            for u in users:
                for name, group in gym_exercises:
                    # Ensure exercise row exists for user
                    c.execute('SELECT id FROM exercises WHERE username=? AND name=?', (u, name))
                    row = c.fetchone()
                    if row:
                        ex_id = row['id'] if isinstance(row, sqlite3.Row) else row[0]
                    else:
                        c.execute('INSERT INTO exercises (username, name, muscle_group) VALUES (?, ?, ?)', (u, name, group))
                        ex_id = c.lastrowid
                    # Generate progressive sets over dates
                    base = random.randint(50, 90)
                    for idx, d in enumerate(dates):
                        weight = base + int(idx * random.uniform(0.2, 0.8))
                        reps = random.choice([3,5,8])
                        c.execute('INSERT INTO exercise_sets (exercise_id, weight, reps, created_at) VALUES (?, ?, ?, ?)', (ex_id, weight, reps, d.isoformat()))

            # Seed crossfit lifts and WODs
            def time_str(seconds):
                m = seconds // 60; s = seconds % 60
                return f"{int(m)}:{int(s):02d}"

            for u in users:
                # Lifts
                for name in cf_lifts:
                    base = random.randint(40, 100)
                    for idx, d in enumerate(dates):
                        w = base + int(idx * random.uniform(0.3, 1.0))
                        reps = random.choice([1,3,5])
                        c.execute('''INSERT INTO crossfit_entries (username, type, name, weight, reps, created_at)
                                     VALUES (?, 'lift', ?, ?, ?, ?)''', (u, name, w, reps, d.isoformat()))
                # WODs (lower is better)
                for name in cf_wods:
                    base = random.randint(300, 1200)  # seconds
                    for idx, d in enumerate(dates):
                        seconds = max(120, int(base - idx * random.uniform(1.0, 4.0)))
                        score = time_str(seconds)
                        c.execute('''INSERT INTO crossfit_entries (username, type, name, score, score_numeric, created_at)
                                     VALUES (?, 'wod', ?, ?, ?, ?)''', (u, name, score, seconds, d.isoformat()))

            conn.commit()

        return jsonify({'success': True, 'users_created': len(users), 'dates': len(dates)})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/get_user_id_by_username', methods=['POST'])
@login_required
def api_get_user_id_by_username():
    try:
        username = request.form.get('username','').strip()
        if not username:
            return jsonify({ 'success': False, 'error': 'username required' }), 400
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT id FROM users WHERE username=?", (username,))
            row = c.fetchone()
            if not row:
                return jsonify({ 'success': False, 'error': 'user not found' }), 404
            user_id = row['id'] if hasattr(row, 'keys') else row[0]
            return jsonify({ 'success': True, 'user_id': user_id })
    except Exception as e:
        logger.error(f"Error resolving user id: {e}")
        return jsonify({ 'success': False, 'error': 'server error' }), 500

@app.route('/api/get_user_profile_brief', methods=['GET'])
@login_required
def api_get_user_profile_brief():
    """Return brief profile info for a given username: display_name and profile_picture (relative path)"""
    try:
        username = request.args.get('username','').strip()
        if not username:
            return jsonify({ 'success': False, 'error': 'username required' }), 400
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT display_name, profile_picture FROM user_profiles WHERE username=?", (username,))
            row = c.fetchone()
            display_name = None
            profile_picture = None
            if row:
                try:
                    display_name = row['display_name'] if hasattr(row, 'keys') and 'display_name' in row.keys() else row[0]
                    profile_picture = row['profile_picture'] if hasattr(row, 'keys') and 'profile_picture' in row.keys() else row[1]
                except Exception:
                    pass
        return jsonify({ 'success': True, 'username': username, 'display_name': display_name or username, 'profile_picture': profile_picture })
    except Exception as e:
        logger.error(f"Error in api_get_user_profile_brief: {e}")
        return jsonify({ 'success': False, 'error': 'server error' }), 500

# --- Typing status APIs ---
@app.route('/api/typing', methods=['POST'])
@login_required
def api_set_typing():
    try:
        me = session['username']
        data = request.get_json(force=True, silent=True) or {}
        peer = (data.get('peer') or '').strip()
        is_typing = 1 if data.get('is_typing') else 0
        if not peer:
            return jsonify({ 'success': False, 'error': 'peer required' }), 400
        now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("""
                INSERT INTO typing_status (user, peer, is_typing, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(user, peer) DO UPDATE SET is_typing=excluded.is_typing, updated_at=excluded.updated_at
            """, (me, peer, is_typing, now))
            conn.commit()
        return jsonify({ 'success': True })
    except Exception as e:
        logger.error(f"typing set error: {e}")
        return jsonify({ 'success': False }), 500

@app.route('/api/typing', methods=['GET'])
@login_required
def api_get_typing():
    try:
        me = session['username']
        peer = (request.args.get('peer') or '').strip()
        if not peer:
            return jsonify({ 'success': False, 'error': 'peer required' }), 400
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT is_typing, updated_at FROM typing_status WHERE user=? AND peer=?", (peer, me))
            row = c.fetchone()
        if not row:
            return jsonify({ 'success': True, 'is_typing': False })
        is_typing, updated_at = (row['is_typing'], row['updated_at']) if hasattr(row, 'keys') else (row[0], row[1])
        try:
            last = datetime.fromisoformat(updated_at) if 'T' in updated_at else datetime.strptime(updated_at, '%Y-%m-%d %H:%M:%S')
            fresh = (datetime.now() - last).total_seconds() <= TYPING_TTL_SECONDS
        except Exception:
            fresh = False
        return jsonify({ 'success': True, 'is_typing': bool(is_typing) and fresh })
    except Exception as e:
        logger.error(f"typing get error: {e}")
        return jsonify({ 'success': False, 'is_typing': False }), 500

# Web Push: expose public VAPID key
@app.route('/api/push/public_key')
@login_required
def api_push_public_key():
    if not VAPID_PUBLIC_KEY:
        return jsonify({ 'publicKey': '' })
    return jsonify({ 'publicKey': VAPID_PUBLIC_KEY })

# Save a browser subscription
@app.route('/api/push/subscribe', methods=['POST'])
@login_required
def api_push_subscribe():
    try:
        sub = request.get_json(force=True, silent=True) or {}
        endpoint = sub.get('endpoint')
        keys = sub.get('keys') or {}
        p256dh = keys.get('p256dh')
        authk = keys.get('auth')
        if not endpoint:
            return jsonify({ 'success': False, 'error': 'invalid subscription' }), 400
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("REPLACE INTO push_subscriptions (username, endpoint, p256dh, auth) VALUES (?,?,?,?)",
                      (session['username'], endpoint, p256dh, authk))
            conn.commit()
        return jsonify({ 'success': True })
    except Exception as e:
        logger.error(f"push subscribe error: {e}")
        return jsonify({ 'success': False }), 500

@app.route('/api/push/status')
@login_required
def api_push_status():
    """Return whether the current user has an active push subscription stored."""
    try:
        username = session.get('username')
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT COUNT(1) FROM push_subscriptions WHERE username=?", (username,))
            row = c.fetchone()
            count = row[0] if row and not hasattr(row, 'keys') else (row['COUNT(1)'] if row else 0)
        return jsonify({ 'success': True, 'hasSubscription': (count or 0) > 0 })
    except Exception as e:
        logger.error(f"push status error: {e}")
        return jsonify({ 'success': False, 'hasSubscription': False }), 500

def send_push_to_user(target_username: str, payload: dict):
    if not VAPID_PUBLIC_KEY or not VAPID_PRIVATE_KEY:
        logger.warning("VAPID keys missing; push disabled")
        return
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE username=?", (target_username,))
            subs = c.fetchall()
        for s in subs:
            try:
                subscription_info = {
                    'endpoint': s['endpoint'] if hasattr(s, 'keys') else s[0],
                    'keys': {
                        'p256dh': s['p256dh'] if hasattr(s, 'keys') else s[1],
                        'auth': s['auth'] if hasattr(s, 'keys') else s[2],
                    }
                }
                webpush(
                    subscription_info=subscription_info,
                    data=json.dumps(payload),
                    vapid_private_key=VAPID_PRIVATE_KEY,
                    vapid_claims={ 'sub': VAPID_SUBJECT }
                )
            except WebPushException as wpe:
                logger.warning(f"webpush failed: {wpe}")
                # Clean up stale subscriptions (HTTP 404/410)
                try:
                    status_code = getattr(getattr(wpe, 'response', None), 'status_code', None)
                except Exception:
                    status_code = None
                if status_code in (404, 410):
                    try:
                        endpoint_to_delete = s['endpoint'] if hasattr(s, 'keys') else s[0]
                        with get_db_connection() as conn_del:
                            cdel = conn_del.cursor()
                            cdel.execute("DELETE FROM push_subscriptions WHERE endpoint=?", (endpoint_to_delete,))
                            conn_del.commit()
                        logger.info(f"Deleted stale push subscription for endpoint {endpoint_to_delete}")
                    except Exception as de:
                        logger.warning(f"failed to delete stale subscription: {de}")
            except Exception as e:
                logger.warning(f"push error: {e}")
    except Exception as e:
        logger.error(f"send_push_to_user error: {e}")

@app.route('/api/push/test', methods=['POST'])
@login_required
def api_push_test():
    """Send a test push notification to the current user."""
    try:
        if not VAPID_PUBLIC_KEY or not VAPID_PRIVATE_KEY:
            return jsonify({ 'success': False, 'error': 'VAPID keys not configured on server' }), 400
        username = session.get('username')
        data = request.get_json(silent=True) or {}
        title = data.get('title') or 'Test notification'
        body = data.get('body') or 'If you see this, push works.'
        url = data.get('url') or '/'
        send_push_to_user(username, { 'title': title, 'body': body, 'url': url })
        return jsonify({ 'success': True })
    except Exception as e:
        logger.error(f"push test error: {e}")
        return jsonify({ 'success': False, 'error': 'failed to send' }), 500

@app.route('/get_active_chat_counts')
@login_required
def get_active_chat_counts():
    """Return number of distinct chat partners per community for the current user."""
    username = session.get('username')
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            # Map usernames to rowid for joins
            c.execute("SELECT rowid FROM users WHERE username=?", (username,))
            me = c.fetchone()
            if not me:
                return jsonify({ 'success': False, 'error': 'user not found' }), 404
            # Communities the user belongs to
            c.execute("""
                SELECT c.id, c.name
                FROM communities c
                JOIN user_communities uc ON c.id = uc.community_id
                JOIN users u ON uc.user_id = u.id
                WHERE u.username = ?
            """, (username,))
            comms = [dict(row) for row in c.fetchall()]
            results = []
            for comm in comms:
                # Distinct partners in this community: any user who shares this community and has message with me
                c.execute("""
                    SELECT DISTINCT m.sender as user
                    FROM messages m
                    WHERE m.receiver = ?
                    UNION
                    SELECT DISTINCT m.receiver as user
                    FROM messages m
                    WHERE m.sender = ?
                """, (username, username))
                partners = {row['user'] for row in c.fetchall()}
                if not partners:
                    results.append({ 'community_id': comm['id'], 'community_name': comm['name'], 'active_chats': 0 })
                    continue
                placeholders = ",".join(["?"]*len(partners))
                params = list(partners)
                # Intersect with community members
                c.execute(f"""
                    SELECT COUNT(DISTINCT u.username) as cnt
                    FROM users u
                    JOIN user_communities uc ON u.id = uc.user_id
                    WHERE uc.community_id = ? AND u.username IN ({placeholders}) AND u.username != ?
                """, [comm['id'], *params, username])
                row = c.fetchone()
                cnt = row['cnt'] if isinstance(row, dict) else (row[0] if row else 0)
                results.append({ 'community_id': comm['id'], 'community_name': comm['name'], 'active_chats': cnt or 0 })
            return jsonify({ 'success': True, 'counts': results })
    except Exception as e:
        logger.error(f"Error in get_active_chat_counts: {e}")
        return jsonify({ 'success': False, 'error': 'server error' }), 500

if __name__ == '__main__':
    app.run(debug=False, host='0.0.0.0', port=8080)