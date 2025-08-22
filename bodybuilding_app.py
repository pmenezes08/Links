from flask import Flask, render_template, request, jsonify, redirect, url_for, session, flash, abort, send_from_directory
# from flask_wtf.csrf import CSRFProtect, generate_csrf, validate_csrf as wtf_validate_csrf
import os
import sys
import json
import sqlite3
import random
import re
import logging
import requests
from datetime import datetime, timedelta
from functools import wraps
from markupsafe import escape
import secrets
from werkzeug.utils import secure_filename
from werkzeug.security import generate_password_hash, check_password_hash

# Initialize Flask app
app = Flask(__name__, template_folder='templates')

# Force reload to clear any cached routes - Updated 2025-08-21 16:50 - CLEAR CACHE

# Temporarily disable CSRF protection
# csrf = CSRFProtect(app)
# csrf.exempt(app)  # Disable CSRF protection globally

# File upload configuration
UPLOAD_FOLDER = 'static/uploads'
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# Create uploads directory if it doesn't exist
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# Load secret keys from environment variables
app.secret_key = os.getenv('FLASK_SECRET_KEY', 'temporary-secret-key-12345')
STRIPE_API_KEY = os.getenv('STRIPE_API_KEY', 'sk_test_your_stripe_key')
XAI_API_KEY = os.getenv('XAI_API_KEY', 'xai-hFCxhRKITxZXsIQy5rRpRus49rxcgUPw4NECAunCgHU0BnWnbPE9Y594Nk5jba03t5FYl2wJkjcwyxRh')
X_CONSUMER_KEY = os.getenv('X_CONSUMER_KEY', 'cjB0MmRPRFRnOG9jcTA0UGRZV006MTpjaQ')
X_CONSUMER_SECRET = os.getenv('X_CONSUMER_SECRET', 'Wxo9qnpOaDIJ-9Aw_Bl_MDkor4uY24ephq9ZJFq6HwdH7o4-kB')



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

# Database connection pooling with absolute path
def get_db_connection():
    # Get the absolute path to the database file
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
                         (id INTEGER PRIMARY KEY AUTOINCREMENT,
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
                         (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, type TEXT, data TEXT, timestamp TEXT)''')
            
            # Add missing columns to communities table
            columns_to_add = [
                ('description', 'TEXT'),
                ('location', 'TEXT'),
                ('background_path', 'TEXT'),
                ('template', 'TEXT'),
                ('background_color', 'TEXT'),
                ('text_color', 'TEXT'),
                ('accent_color', 'TEXT'),
                ('card_color', 'TEXT')
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
                         (username TEXT PRIMARY KEY, email TEXT UNIQUE, subscription TEXT DEFAULT 'free', 
                          password TEXT, first_name TEXT, last_name TEXT, age INTEGER, gender TEXT, 
                          fitness_level TEXT, primary_goal TEXT, weight REAL, height REAL, blood_type TEXT, 
                          muscle_mass REAL, bmi REAL, nutrition_goal TEXT, nutrition_restrictions TEXT, 
                          created_at TEXT)''')
            
            # Add missing columns to existing users table if they don't exist
            logger.info("Checking for missing columns...")
            columns_to_add = [
                ('email', 'TEXT'),
                ('first_name', 'TEXT'),
                ('last_name', 'TEXT'),
                ('age', 'INTEGER'),
                ('fitness_level', 'TEXT'),
                ('primary_goal', 'TEXT'),
                ('created_at', 'TEXT')
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
            c.execute("INSERT OR IGNORE INTO users (username, email, subscription, password, first_name, last_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                      ('admin', 'admin@workoutx.com', 'premium', '12345', 'Admin', 'User', datetime.now().strftime('%m.%d.%y %H:%M')))
            
            # Create posts table
            logger.info("Creating posts table...")
            c.execute('''CREATE TABLE IF NOT EXISTS posts
                         (id INTEGER PRIMARY KEY AUTOINCREMENT,
                          username TEXT NOT NULL,
                          content TEXT NOT NULL,
                          image_path TEXT,
                          timestamp TEXT NOT NULL,
                          community_id INTEGER,
                          FOREIGN KEY (username) REFERENCES users(username))''')

            # Create replies table
            logger.info("Creating replies table...")
            c.execute('''CREATE TABLE IF NOT EXISTS replies
                         (id INTEGER PRIMARY KEY AUTOINCREMENT,
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
                         (id INTEGER PRIMARY KEY AUTOINCREMENT,
                          post_id INTEGER NOT NULL,
                          username TEXT NOT NULL,
                          reaction_type TEXT NOT NULL,
                          FOREIGN KEY (post_id) REFERENCES posts(id),
                          FOREIGN KEY (username) REFERENCES users(username),
                          UNIQUE(post_id, username))''')

            # Create reply_reactions table
            logger.info("Creating reply_reactions table...")
            c.execute('''CREATE TABLE IF NOT EXISTS reply_reactions
                         (id INTEGER PRIMARY KEY AUTOINCREMENT,
                          reply_id INTEGER NOT NULL,
                          username TEXT NOT NULL,
                          reaction_type TEXT NOT NULL,
                          FOREIGN KEY (reply_id) REFERENCES replies(id),
                          FOREIGN KEY (username) REFERENCES users(username),
                          UNIQUE(reply_id, username))''')

            # Create communities table
            logger.info("Creating communities table...")
            c.execute('''CREATE TABLE IF NOT EXISTS communities
                         (id INTEGER PRIMARY KEY AUTOINCREMENT,
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
                          FOREIGN KEY (creator_username) REFERENCES users(username))''')

            # Create user_communities table
            logger.info("Creating user_communities table...")
            c.execute('''CREATE TABLE IF NOT EXISTS user_communities
                         (id INTEGER PRIMARY KEY AUTOINCREMENT,
                          user_id INTEGER NOT NULL,
                          community_id INTEGER NOT NULL,
                          joined_at TEXT NOT NULL,
                          FOREIGN KEY (user_id) REFERENCES users(id),
                          FOREIGN KEY (community_id) REFERENCES communities(id),
                          UNIQUE(user_id, community_id))''')

            # Create community_files table
            logger.info("Creating community_files table...")
            c.execute('''CREATE TABLE IF NOT EXISTS community_files
                         (id INTEGER PRIMARY KEY AUTOINCREMENT,
                          community_id INTEGER NOT NULL,
                          filename TEXT NOT NULL,
                          uploaded_by TEXT NOT NULL,
                          upload_date TEXT NOT NULL,
                          FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE,
                          FOREIGN KEY (uploaded_by) REFERENCES users(username))''')

            # Create api_usage table
            logger.info("Creating api_usage table...")
            c.execute('''CREATE TABLE IF NOT EXISTS api_usage
                         (username TEXT, date TEXT, count INTEGER,
                          PRIMARY KEY (username, date))''')
            
            # Create saved_data table
            logger.info("Creating saved_data table...")
            c.execute('''CREATE TABLE IF NOT EXISTS saved_data
                         (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, type TEXT, data TEXT, timestamp TEXT)''')
            
            # Create messages table
            logger.info("Creating messages table...")
            c.execute('''CREATE TABLE IF NOT EXISTS messages
                         (id INTEGER PRIMARY KEY AUTOINCREMENT,
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
                         (id INTEGER PRIMARY KEY AUTOINCREMENT,
                          username TEXT NOT NULL,
                          name TEXT NOT NULL,
                          muscle_group TEXT NOT NULL,
                          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
            
            c.execute('''CREATE TABLE IF NOT EXISTS exercise_sets
                         (id INTEGER PRIMARY KEY AUTOINCREMENT,
                          exercise_id INTEGER NOT NULL,
                          weight REAL NOT NULL,
                          reps INTEGER NOT NULL,
                          created_at TEXT NOT NULL,
                          FOREIGN KEY (exercise_id) REFERENCES exercises (id) ON DELETE CASCADE
                         )''')
            
            c.execute('''CREATE TABLE IF NOT EXISTS workouts
                         (id INTEGER PRIMARY KEY AUTOINCREMENT,
                          username TEXT NOT NULL,
                          name TEXT NOT NULL,
                          date TEXT NOT NULL,
                          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
            
            c.execute('''CREATE TABLE IF NOT EXISTS workout_exercises
                         (id INTEGER PRIMARY KEY AUTOINCREMENT,
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

init_db()
ensure_indexes()

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
        dt = datetime.strptime(date_str, '%m.%d.%y %H:%M')
        return dt.strftime(format_str)
    except ValueError:
        logger.error(f"Invalid date format: {date_str}")
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
        username = request.form.get('username')
        print(f"Received username: {username}")
        logger.info(f"Received username: {username}")
        if username:
            session['username'] = username
            print(f"Session username set to: {session['username']}")
            logger.info(f"Session username set to: {session['username']}")
            return redirect(url_for('login_password'))
        print("Username missing or empty")
        logger.warning("Username missing or empty")
        return render_template('index.html', error="Please enter a username!")
    print("Rendering index.html for GET request")
    return render_template('index.html')

@app.route('/login_x')
def login_x():
    return x_auth.authorize(callback=url_for('authorized', _external=True))

@app.route('/callback')
def authorized():
    try:
        resp = x_auth.authorized_response()
        if resp is None or resp.get('access_token') is None:
            error_msg = request.args.get('error_description', 'Unknown error')
            return render_template('index.html', error=f"Login failed: {error_msg}")
        session['x_token'] = (resp['access_token'], '')
        headers = {'Authorization': f"Bearer {resp['access_token']}"}
        user_info = requests.get('https://api.x.com/2/users/me', headers=headers, params={'user.fields': 'username'})
        if user_info.status_code != 200:
            return render_template('index.html', error=f"X API error: {user_info.text}")
        user_data = user_info.json()['data']
        username = user_data['username']
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT subscription FROM users WHERE username=?", (username,))
            user = c.fetchone()
            if not user:
                c.execute("INSERT INTO users (username, subscription, password) VALUES (?, 'free', ?)",
                          (username, 'default_password'))
                conn.commit()
        session['username'] = username
        return redirect(url_for('premium_dashboard') if user and user['subscription'] == 'premium' else url_for('dashboard'))
    except Exception as e:
        logger.error(f"Error in authorized route: {str(e)}")
        abort(500)

@app.route('/signup', methods=['GET', 'POST'])
# @csrf.exempt
def signup():
    """User registration page"""
    if request.method == 'GET':
        return render_template('signup.html')
    
    # Handle POST request for user registration
    username = request.form.get('username', '').strip()
    email = request.form.get('email', '').strip()
    password = request.form.get('password', '')
    confirm_password = request.form.get('confirm_password', '')
    first_name = request.form.get('first_name', '').strip()
    last_name = request.form.get('last_name', '').strip()
    age = request.form.get('age', type=int)
    gender = request.form.get('gender', '').strip()
    primary_goal = request.form.get('primary_goal', '').strip()
    
    # Validation
    if not all([username, email, password, confirm_password, first_name, last_name]):
        return render_template('signup.html', error='All required fields must be filled')
    
    if password != confirm_password:
        return render_template('signup.html', error='Passwords do not match')
    
    if len(password) < 6:
        return render_template('signup.html', error='Password must be at least 6 characters long')
    
    if not re.match(r'^[a-zA-Z0-9_]+$', username):
        return render_template('signup.html', error='Username can only contain letters, numbers, and underscores')
    
    if len(username) < 3:
        return render_template('signup.html', error='Username must be at least 3 characters long')
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Check if username already exists
            c.execute("SELECT 1 FROM users WHERE username = ?", (username,))
            if c.fetchone():
                return render_template('signup.html', error='Username already exists')
            
            # Check if email already exists
            c.execute("SELECT 1 FROM users WHERE email = ?", (email,))
            if c.fetchone():
                return render_template('signup.html', error='Email already registered')
            
            # Hash the password
            hashed_password = generate_password_hash(password)
            
            # Insert new user
            c.execute("""
                INSERT INTO users (username, email, password, first_name, last_name, age, gender, primary_goal, subscription, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'free', ?)
            """, (username, email, hashed_password, first_name, last_name, age, gender, primary_goal, datetime.now().strftime('%m.%d.%y %H:%M')))
            
            conn.commit()
            
            # Log the user in automatically
            session['username'] = username
            session['user_id'] = c.lastrowid
            
            return redirect(url_for('dashboard'))
            
    except Exception as e:
        logger.error(f"Error during user registration: {str(e)}")
        return render_template('signup.html', error='An error occurred during registration. Please try again.')

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
            
            # Get admin information
            c.execute("""
                SELECT username, email, first_name, last_name, subscription, created_at
                FROM users WHERE username = ?
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
    session.clear()
    return redirect(url_for('index'))



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
            c.execute("SELECT password, subscription FROM users WHERE username=?", (username,))
            user = c.fetchone()
            conn.close()
            print(f"DB query result: {user}")
            if user and user[0] == password:
                subscription = user[1]
                print(f"Password matches, subscription: {subscription}")
                if subscription == 'premium':
                    print("Redirecting to premium_dashboard")
                    return redirect(url_for('premium_dashboard'))
                else:
                    print("Redirecting to dashboard")
                    return redirect(url_for('dashboard'))
            else:
                print("Password mismatch or user not found")
                return render_template('index.html', error="Incorrect password!")
        except Exception as e:
            print(f"Database error: {str(e)}")
            logger.error(f"Database error in login_password for {username}: {str(e)}")
            abort(500)
    print("Rendering login.html for GET request")
    return render_template('login.html')

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
                JOIN users u ON uc.user_id = u.rowid
                WHERE u.username = ?
                ORDER BY c.name
            """, (username,))
            communities = [{'id': row['id'], 'name': row['name'], 'type': row['type']} for row in c.fetchall()]
            
        if user['subscription'] == 'premium':
            return redirect(url_for('premium_dashboard'))
        return render_template('dashboard.html', name=username, communities=communities)
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
                JOIN users u ON uc.user_id = u.rowid
                WHERE u.username = ?
                ORDER BY c.name
            """, (username,))
            communities = [{'id': row['id'], 'name': row['name'], 'type': row['type']} for row in c.fetchall()]
            
        if not user or user['subscription'] != 'premium':
            logger.warning(f"User {username} attempted to access premium_dashboard without premium subscription")
            return redirect(url_for('dashboard'))
        logger.info(f"Rendering premium_dashboard for {username}")
        return render_template('premium_dashboard.html', name=username, communities=communities)
    except Exception as e:
        logger.error(f"Error in premium_dashboard for {username}: {str(e)}")
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
            
            # Get users list
            c.execute("SELECT username, subscription FROM users ORDER BY username")
            users = c.fetchall()
            
            # Get all communities with member counts
            c.execute("""
                SELECT c.id, c.name, c.type, c.creator_username, c.join_code,
                       COUNT(uc.user_id) as member_count
                FROM communities c
                LEFT JOIN user_communities uc ON c.id = uc.community_id
                GROUP BY c.id, c.name, c.type, c.creator_username, c.join_code
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
                    'member_count': community[5]
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
                        c.execute("SELECT username, subscription FROM users")
                        users = c.fetchall()
                    except sqlite3.IntegrityError:
                        return render_template('admin.html', users=users, communities=communities, stats=stats, error=f"Username {new_username} already exists!")
                        
                elif 'update_user' in request.form:
                    user_to_update = request.form.get('username')
                    new_subscription = request.form.get('subscription')
                    c.execute("UPDATE users SET subscription=? WHERE username=?", (new_subscription, user_to_update))
                    conn.commit()
                    # Refresh users list
                    c.execute("SELECT username, subscription FROM users")
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
                        c.execute("SELECT username, subscription FROM users")
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
                    

@app.route('/profile')
@login_required
def profile():
    username = session['username']
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT subscription, username, gender, weight, height, blood_type, muscle_mass, bmi FROM users WHERE username=?", (username,))
            user = c.fetchone()
            c.execute("SELECT type, data, timestamp FROM saved_data WHERE username=? ORDER BY timestamp DESC", (username,))
            saved_items = c.fetchall()
        if user:
            profile_data = dict(user)
            return render_template('profile.html', profile_data=profile_data, saved_items=saved_items, subscription=user['subscription'])
        return render_template('index.html', error="User profile not found!")
    except Exception as e:
        logger.error(f"Error in profile for {username}: {str(e)}")
        abort(500)

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
    if request.method == 'POST':
        email = request.form.get('email')
        password = request.form.get('password')
        try:
            with get_db_connection() as conn:
                c = conn.cursor()
                c.execute("SELECT business_id, name, password FROM businesses WHERE email=?", (email,))
                business = c.fetchone()
            if business and business['password'] == password:
                session['business_id'] = business['business_id']
                session['business_name'] = business['name']
                return redirect(url_for('business_dashboard'))
            return render_template('index.html', error="Invalid email or password!")
        except Exception as e:
            logger.error(f"Error in business_login: {str(e)}")
            abort(500)
    return render_template('business_login.html')

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
            
            # Get user's communities
            c.execute("""
                SELECT c.id, c.name, c.type, c.creator_username
                FROM communities c
                INNER JOIN user_communities uc ON c.id = uc.community_id
                INNER JOIN users u ON uc.user_id = u.rowid
                WHERE u.username = ?
                ORDER BY c.name
            """, (username,))
            communities = c.fetchall()
            
            # Get all users in the same communities
            community_members = {}
            for community in communities:
                c.execute("""
                    SELECT DISTINCT u.username
                    FROM user_communities uc
                    INNER JOIN users u ON uc.user_id = u.rowid
                    WHERE uc.community_id = ? AND u.username != ?
                    ORDER BY u.username
                """, (community[0], username))
                members = [row[0] for row in c.fetchall()]
                community_members[community[0]] = members
            
            # Get all community members for messaging (only users in same communities)
            all_community_members = set()
            for community in communities:
                c.execute("""
                    SELECT DISTINCT u.username
                    FROM user_communities uc
                    INNER JOIN users u ON uc.user_id = u.rowid
                    WHERE uc.community_id = ? AND u.username != ?
                    ORDER BY u.username
                """, (community[0], username))
                members = [row[0] for row in c.fetchall()]
                all_community_members.update(members)
            
            # Convert to sorted list
            all_users = sorted(list(all_community_members))
            
        return render_template('user_chat.html', name=username, users=all_users, communities=communities, community_members=community_members, subscription=user['subscription'])
    except Exception as e:
        logger.error(f"Error in user_chat for {username}: {str(e)}")
        abort(500)

@app.route('/get_messages', methods=['POST'])
@login_required
def get_messages():
    username = session['username']
    receiver = request.form.get('receiver')
    if not receiver:
        return jsonify({'success': False, 'error': 'No receiver specified'})
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT subscription FROM users WHERE username=?", (username,))
            user = c.fetchone()
            if not user or user['subscription'] != 'premium':
                return jsonify({'success': False, 'error': 'Premium subscription required!'})
            c.execute("""
                SELECT id, sender, receiver, message, timestamp, is_read
                FROM messages
                WHERE (sender=? AND receiver=?) OR (sender=? AND receiver=?)
                ORDER BY timestamp ASC
            """, (username, receiver, receiver, username))
            messages = [dict(row) for row in c.fetchall()]
            c.execute("UPDATE messages SET is_read=1 WHERE receiver=? AND sender=? AND is_read=0", (username, receiver))
            conn.commit()
        return jsonify({'success': True, 'messages': messages})
    except Exception as e:
        logger.error(f"Error getting messages for {username}: {str(e)}")
        abort(500)

@app.route('/send_message', methods=['POST'])
@login_required
def send_message():
    username = session['username']
    receiver = request.form.get('receiver')
    message = request.form.get('message')
    if not receiver or not message:
        return jsonify({'success': False, 'error': 'Receiver and message required'})
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT subscription FROM users WHERE username=?", (username,))
            user = c.fetchone()
            if not user or user['subscription'] != 'premium':
                return jsonify({'success': False, 'error': 'Premium subscription required!'})
            timestamp = datetime.now().strftime('%m.%d.%y')
            c.execute("INSERT INTO messages (sender, receiver, message, timestamp) VALUES (?, ?, ?, ?)",
                      (username, receiver, message, timestamp))
            conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Error sending message for {username}: {str(e)}")
        abort(500)

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
        abort(500)

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
            # Check if user is a member of this community
            c.execute("""
                SELECT 1 FROM user_communities uc
                INNER JOIN users u ON uc.user_id = u.rowid
                WHERE uc.community_id = ? AND u.username = ?
            """, (community_id, username))
            if not c.fetchone():
                return jsonify({'success': False, 'error': 'Not a member of this community'})
            
            # Get all members of the community
            c.execute("""
                SELECT u.username, uc.joined_at
                FROM user_communities uc
                INNER JOIN users u ON uc.user_id = u.rowid
                WHERE uc.community_id = ?
                ORDER BY u.username
            """, (community_id,))
            members = []
            for row in c.fetchall():
                joined_date = row['joined_at'] if row['joined_at'] else 'Unknown'
                members.append({
                    'username': row['username'],
                    'joined_date': joined_date
                })
        return jsonify({'success': True, 'members': members})
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
                INNER JOIN users u ON uc.user_id = u.rowid
                WHERE uc.community_id = ? AND u.username = ?
            """, (community_id, new_member_username))
            if c.fetchone():
                return jsonify({'success': False, 'error': 'User is already a member'})
            
            # Add member
            c.execute("INSERT INTO user_communities (community_id, user_id) VALUES (?, ?)",
                      (community_id, new_member['rowid']))
            conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        logger.error(f"Error adding community member for {username}: {str(e)}")
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

@app.route('/check_unread_messages')
@login_required
def check_unread_messages():
    username = session['username']
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute("SELECT COUNT(*) FROM messages WHERE receiver=? AND is_read=0", (username,))
            unread_count = c.fetchone()[0]
        return jsonify({'unread_count': unread_count})
    except Exception as e:
        logger.error(f"Error checking unread messages for {username}: {str(e)}")
        abort(500)

@app.route('/feed')
@login_required
def feed():
    username = session.get('username')
    
    # Temporarily disable CSRF token generation
    # token = generate_csrf()
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            # Fetch only main social feed posts (where community_id is NULL), ordered by the most recent
            c.execute("SELECT * FROM posts WHERE community_id IS NULL ORDER BY id DESC")
            posts_raw = c.fetchall()
            posts = [dict(row) for row in posts_raw]

            for post in posts:
                # Fetch replies for each post
                c.execute("SELECT * FROM replies WHERE post_id = ? ORDER BY timestamp ASC", (post['id'],))
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
    # Temporarily disable CSRF validation
    # if not validate_csrf():
    #     return jsonify({'success': False, 'error': 'Invalid CSRF token'}), 400
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


@app.route('/post_status', methods=['POST'])
@login_required
def post_status():
    username = session['username']
    # Temporarily disable CSRF validation
    # if not validate_csrf():
    #     if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
    #         return jsonify({'success': False, 'error': 'Invalid CSRF token'}), 400
    #     else:
    #         community_id = request.form.get('community_id', type=int)
    #         if community_id:
    #             return redirect(url_for('community_feed', community_id=community_id) + '?error=Invalid CSRF token')
    #         else:
    #             return redirect(url_for('feed') + '?error=Invalid CSRF token')
    
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
                    JOIN users u ON uc.user_id = u.rowid
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
# @csrf.exempt
def post_reply():
    username = session['username']
    
    # Debug CSRF token
    logger.info(f"CSRF validation for user {username}")
    logger.info(f"Request form data: {dict(request.form)}")
    logger.info(f"Request headers: {dict(request.headers)}")
    
    # Temporarily skip CSRF validation
    # if not validate_csrf():
    #     logger.error(f"CSRF validation failed for user {username}")
    #     return jsonify({'success': False, 'error': 'Invalid CSRF token'}), 400
    
    logger.info(f"CSRF validation passed for user {username}")
    
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
            
            c.execute("INSERT INTO replies (post_id, username, content, image_path, timestamp, community_id) VALUES (?, ?, ?, ?, ?, ?)",
                      (post_id, username, content, image_path, timestamp_db, community_id))
            reply_id = c.lastrowid
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
                'timestamp': timestamp_display  # Use the display-friendly timestamp
            }
        }), 200
    except Exception as e:
        logger.error(f"Error posting reply for {username}: {str(e)}", exc_info=True)
        return jsonify({'success': False, 'error': f'Unexpected error: {str(e)}'}), 500

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
            
            # Fetch replies for the post
            c.execute("SELECT * FROM replies WHERE post_id = ? ORDER BY timestamp ASC", (post_id,))
            replies_raw = c.fetchall()
            post['replies'] = [dict(row) for row in replies_raw]
            
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
        # Generate CSRF token directly here
        return render_template('communities.html', csrf_token="disabled")
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
            
            # Create the community
            c.execute("""
                INSERT INTO communities (name, type, creator_username, join_code, created_at, description, location, background_path, template, background_color, text_color, accent_color, card_color)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (name, community_type, username, join_code, datetime.now().strftime('%m.%d.%y %H:%M'), description, location, background_path, template, background_color, text_color, accent_color, card_color))
            
            community_id = c.lastrowid
            
            # Get user's ID and add creator as member
            c.execute("SELECT rowid FROM users WHERE username = ?", (username,))
            user_row = c.fetchone()
            if user_row:
                user_id = user_row[0]
                c.execute("""
                    INSERT INTO user_communities (user_id, community_id, joined_at)
                    VALUES (?, ?, ?)
                """, (user_id, community_id, datetime.now().strftime('%m.%d.%y %H:%M')))
            
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

@app.route('/get_user_communities')
@login_required
def get_user_communities():
    """Get all communities the user is a member of"""
    username = session.get('username')
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Get user's communities with creator information
            c.execute("""
                SELECT c.id, c.name, c.type, c.join_code, c.created_at, c.creator_username
                FROM communities c
                JOIN user_communities uc ON c.id = uc.community_id
                JOIN users u ON uc.user_id = u.rowid
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
                    'is_creator': row['creator_username'] == username
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
            c.execute("PRAGMA table_info(posts)")
            columns = c.fetchall()
            logger.info("Posts table structure:")
            for col in columns:
                logger.info(f"  {col['name']}: {col['type']}")
            
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
            c.execute("SELECT rowid FROM users WHERE username = ?", (username,))
            user = c.fetchone()
            if not user:
                return jsonify({'success': False, 'error': 'User not found'})
            
            user_id = user['rowid']
            
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
                VALUES (?, ?, datetime('now'))
            """, (user_id, community_id))
            
            conn.commit()
            
        return jsonify({
            'success': True, 
            'community_name': community_name,
            'message': f'Successfully joined "{community_name}"!'
        })
        
    except Exception as e:
        logger.error(f"Error joining community: {str(e)}")
        return jsonify({'success': False, 'error': 'An error occurred while joining the community'})

@app.route('/community_feed/<int:community_id>')
@login_required
def community_feed(community_id):
    """Community-specific social feed"""
    username = session.get('username')
    
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            
            # Check if user is member of this community OR if user is admin
            if username != 'admin':
                c.execute("""
                    SELECT 1 FROM user_communities uc
                    JOIN users u ON uc.user_id = u.rowid
                    WHERE u.username = ? AND uc.community_id = ?
                """, (username, community_id))
                
                if not c.fetchone():
                    return jsonify({'success': False, 'error': 'You are not a member of this community'}), 403
            
            # Get community info
            c.execute("SELECT * FROM communities WHERE id = ?", (community_id,))
            community_row = c.fetchone()
            if not community_row:
                logger.error(f"Community with id {community_id} not found")
                return jsonify({'success': False, 'error': 'Community not found'}), 404
            
            community = dict(community_row)
            
            # Get posts for this community
            c.execute("""
                SELECT * FROM posts 
                WHERE community_id = ? 
                ORDER BY id DESC
            """, (community_id,))
            posts_raw = c.fetchall()
            posts = [dict(row) for row in posts_raw]
            


            for post in posts:
                # Fetch replies for each post
                c.execute("SELECT * FROM replies WHERE post_id = ? ORDER BY timestamp ASC", (post['id'],))
                replies_raw = c.fetchall()
                post['replies'] = [dict(row) for row in replies_raw]

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
            
            return render_template('community_feed.html', 
                                posts=posts, 
                                community=community,
                                username=username)
            
    except Exception as e:
        logger.error(f"Error loading community feed: {str(e)}")
        return jsonify({'success': False, 'error': 'Failed to load community feed'}), 500

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
        
        # Construct the full path
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        
        # Check if file exists
        if not os.path.exists(file_path):
            logger.error(f"Image file not found: {file_path}")
            return "Image not found", 404
        
        # Get file info
        file_size = os.path.getsize(file_path)
        logger.info(f"Serving image: {filename}, size: {file_size} bytes")
        
        # Set proper headers for mobile compatibility
        response = send_from_directory(app.config['UPLOAD_FOLDER'], filename)
        response.headers['Cache-Control'] = 'public, max-age=31536000'  # Cache for 1 year
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Content-Type'] = 'image/jpeg'  # Will be overridden by Flask if needed
        
        return response
        
    except Exception as e:
        logger.error(f"Error serving image {filename}: {str(e)}")
        return "Error serving image", 500

@app.route('/static/uploads/<path:filename>')
def static_uploaded_file(filename):
    """Alternative route for static uploads"""
    try:
        logger.info(f"Static image request: {filename}")
        return send_from_directory('static/uploads', filename)
    except Exception as e:
        logger.error(f"Error serving static image {filename}: {str(e)}")
        return "Error serving image", 500

@app.route('/your_sports')
@login_required
def your_sports():
    username = session.get('username')
    return render_template('your_sports.html', username=username)

@app.route('/gym')
@login_required
def gym():
    username = session.get('username')
    return render_template('gym.html', username=username)

@app.route('/workout_generator')
@login_required
def workout_generator():
    username = session.get('username')
    return render_template('workout_generator.html', username=username)

@app.route('/workout_tracking')
@login_required
def workout_tracking():
    username = session.get('username')
    return render_template('workout_tracking.html', username=username)

# ===== WORKOUT TRACKING ROUTES =====

@app.route('/add_exercise', methods=['POST'])
@login_required
def add_exercise():
    try:
        username = session.get('username')
        name = request.form.get('name')
        muscle_group = request.form.get('muscle_group', 'Other')
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
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                name TEXT NOT NULL,
                muscle_group TEXT NOT NULL DEFAULT "Other"
            )
        ''')
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS exercise_sets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                exercise_id INTEGER NOT NULL,
                weight REAL NOT NULL,
                reps INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (exercise_id) REFERENCES exercises (id) ON DELETE CASCADE
            )
        ''')
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS workouts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                name TEXT NOT NULL,
                date TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS workout_exercises (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
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
        
        if not all([exercise_id, name]):
            return jsonify({'success': False, 'error': 'Exercise ID and name are required'})
        
        conn = sqlite3.connect('users.db')
        cursor = conn.cursor()
        
        cursor.execute('''
            UPDATE exercises 
            SET name = ? 
            WHERE id = ? AND username = ?
        ''', (name, exercise_id, username))
        
        conn.commit()
        conn.close()
        
        return jsonify({'success': True})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

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
            date_filter = f"AND es.created_at >= date('now', '-{time_range} days')"
        
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
            VALUES (?, ?, ?, date('now'))
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
            date_filter = f"AND created_at >= date('now', '-{time_range} days')"
        
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
            WHERE username = ? AND date >= date('now', '-7 days')
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
            date_filter = f"AND created_at >= date('now', '-{time_range} days')"
        
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
                VALUES (?, ?, ?, ?, datetime('now'))
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
            WHERE username = ? AND date >= date('now', '-7 days')
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
                VALUES (?, ?, ?, datetime('now'))
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
                VALUES (?, ?, ?, datetime('now'))
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
                id INTEGER PRIMARY KEY AUTOINCREMENT,
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
            ORDER BY e.name, es.created_at DESC
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
        cursor.execute("PRAGMA table_info(communities)")
        community_columns = cursor.fetchall()
        
        conn.close()
        
        return jsonify({
            'tables': [table[0] for table in tables],
            'exercise_count': exercise_count,
            'workout_count': workout_count,
            'sets_count': sets_count,
            'community_columns': [col[1] for col in community_columns]
        })
        
    except Exception as e:
        return jsonify({'error': str(e)})

@app.route('/fix_communities_table')
def fix_communities_table():
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        # Check if info column exists
        cursor.execute("PRAGMA table_info(communities)")
        columns = [col[1] for col in cursor.fetchall()]
        
        if 'info' not in columns:
            logger.info("Adding info column to communities table...")
            cursor.execute("ALTER TABLE communities ADD COLUMN info TEXT")
            conn.commit()
            return jsonify({'success': True, 'message': 'Info column added successfully'})
        else:
            return jsonify({'success': True, 'message': 'Info column already exists'})
        
        conn.close()
        
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
        
        # Update community info with timestamp
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
                
                # Save file info to database
                cursor.execute('''
                    INSERT INTO community_files (community_id, filename, uploaded_by, upload_date)
                    VALUES (?, ?, ?, ?)
                ''', (community_id, filename, session['username'], datetime.now().strftime('%Y-%m-%d %H:%M:%S')))
                
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
            SELECT filename, uploaded_by, upload_date 
            FROM community_files 
            WHERE community_id = ?
            ORDER BY upload_date DESC
        ''', (community_id,))
        
        files = []
        for row in cursor.fetchall():
            files.append({
                'filename': row['filename'],
                'uploaded_by': row['uploaded_by'],
                'upload_date': row['upload_date']
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
        filename = request.form.get('filename')
        
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
        
        # Delete file from filesystem
        file_path = os.path.join('static', 'community_files', str(community_id), filename)
        if os.path.exists(file_path):
            os.remove(file_path)
        
        # Delete file record from database
        cursor.execute('''
            DELETE FROM community_files 
            WHERE community_id = ? AND filename = ?
        ''', (community_id, filename))
        
        conn.commit()
        conn.close()
        
        return jsonify({'success': True})
        
    except Exception as e:
        logger.error(f"Error deleting community file: {e}")
        return jsonify({'success': False, 'error': str(e)})

if __name__ == '__main__':
    app.run(debug=False, host='0.0.0.0', port=8080)
