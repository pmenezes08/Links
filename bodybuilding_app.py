from flask import Flask, render_template, request, jsonify, redirect, url_for, session
from flask_oauthlib.client import OAuth
import sqlite3
import random
import sys
import requests
from datetime import datetime
from functools import wraps

# Try to import Stripe, handle if missing
try:
    import stripe
except ImportError:
    print("Error: Stripe module not installed. Run 'pip install stripe'")
    stripe = None

# Import custom modules
from workouts import workouts
from nutrition_plans import nutrition_plans

# Flask app setup
app = Flask(__name__)
app.secret_key = 'cjB0MmRPRFRnOG9jcTA0UGRZV006MTpjaQ'  # Replace with secure key via os.getenv
stripe.api_key = 'sk_test_your_stripe_key'  # Replace with real Stripe key via os.getenv

# X OAuth Setup
oauth = OAuth(app)
x_auth = oauth.remote_app(
    'x',
    consumer_key='cjB0MmRPRFRnOG9jcTA0UGRZV006MTpjaQ',  # Replace with env var
    consumer_secret='Wxo9qnpOaDIJ-9Aw_Bl_MDkor4uY24ephq9ZJFq6HwdH7o4-kB',  # Replace with env var
    request_token_params={'scope': 'users.read'},
    base_url='https://api.x.com/2/',
    request_token_url=None,
    access_token_method='POST',
    access_token_url='https://api.x.com/2/oauth2/token',
    authorize_url='https://x.com/i/oauth2/authorize',
)

# xAI API Setup
XAI_API_KEY = 'xai-hFCxhRKITxZXsIQy5rRpRus49rxcgUPw4NECAunCgHU0BnWnbPE9Y594Nk5jba03t5FYl2wJkjcwyxRh'  # Replace with env var
XAI_API_URL = 'https://api.x.ai/v1/chat/completions'
DAILY_API_LIMIT = 10

# Login required decorator
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'username' not in session:
            print("No username, redirecting to index")
            return redirect(url_for('index'))
        return f(*args, **kwargs)
    return decorated_function

def init_db():
    try:
        conn = sqlite3.connect('users.db')
        c = conn.cursor()
        c.execute('''CREATE TABLE IF NOT EXISTS users
                     (username TEXT PRIMARY KEY, subscription TEXT, password TEXT,
                      gender TEXT, weight REAL, height REAL, blood_type TEXT, muscle_mass REAL, bmi REAL,
                      nutrition_goal TEXT, nutrition_restrictions TEXT)''')
        c.execute('''CREATE TABLE IF NOT EXISTS api_usage
                     (username TEXT, date TEXT, count INTEGER,
                      PRIMARY KEY (username, date))''')
        c.execute('''CREATE TABLE IF NOT EXISTS saved_data
                     (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, type TEXT, data TEXT, timestamp TEXT)''')
        c.execute("INSERT OR IGNORE INTO users (username, subscription, password) VALUES (?, ?, ?)",
                  ('admin', 'premium', '12345'))
        conn.commit()
        print("Database initialized or verified, admin user ensured")
    except Exception as e:
        print(f"Error initializing database: {e}")
    finally:
        conn.close()

init_db()

def check_api_limit(username):
    today = datetime.now().strftime('%Y-%m-%d')
    conn = sqlite3.connect('users.db')
    c = conn.cursor()
    c.execute("SELECT count FROM api_usage WHERE username=? AND date=?", (username, today))
    result = c.fetchone()

    if result:
        count = result[0]
        if count >= DAILY_API_LIMIT:
            conn.close()
            return False
        c.execute("UPDATE api_usage SET count=? WHERE username=? AND date=?", (count + 1, username, today))
    else:
        c.execute("INSERT INTO api_usage (username, date, count) VALUES (?, ?, 1)", (username, today))

    conn.commit()
    conn.close()
    return True

def is_blood_test_related(message):
    blood_keywords = ['blood', 'test', 'results', 'lab', 'hemoglobin', 'glucose', 'cholesterol', 'triglycerides', 'iron',
                      'vitamin', 'hormone', 'testosterone', 'cortisol', 'thyroid', 'platelets', 'rbc', 'wbc', 'lipid']
    return any(keyword in message.lower() for keyword in blood_keywords)

def is_nutrition_related(message):
    nutrition_keywords = ['plan', 'diet', 'nutrition', 'calories', 'protein', 'fat', 'carb', 'carbs', 'meal', 'food']
    return any(keyword in message.lower() for keyword in nutrition_keywords)

@app.route('/', methods=['GET', 'POST'])
def index():
    if request.method == 'POST':
        username = request.form.get('username')
        if username:
            conn = sqlite3.connect('users.db')
            c = conn.cursor()
            c.execute("SELECT username FROM users WHERE username=?", (username,))
            user = c.fetchone()
            conn.close()
            session['username'] = username
            if user:
                return redirect(url_for('login_password'))
            else:
                return redirect(url_for('signup'))
        return render_template('index.html', error="Please enter a username!")
    return render_template('index.html')

@app.route('/login_x')
def login_x():
    return x_auth.authorize(callback=url_for('authorized', _external=True))

@app.route('/callback')
def authorized():
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
    
    conn = sqlite3.connect('users.db')
    c = conn.cursor()
    c.execute("SELECT subscription FROM users WHERE username=?", (username,))
    user = c.fetchone()
    if not user:
        c.execute("INSERT INTO users (username, subscription) VALUES (?, 'free')", (username,))
        conn.commit()
    conn.close()
    
    session['username'] = username
    if user and user[0] == 'premium':
        return redirect(url_for('premium_dashboard'))
    return redirect(url_for('dashboard'))

@app.route('/logout')
def logout():
    session.pop('username', None)
    session.pop('x_token', None)
    return redirect(url_for('index'))

@app.route('/signup', methods=['GET', 'POST'])
@login_required
def signup():
    username = session['username']
    if request.method == 'POST':
        password = request.form.get('password')
        if password:
            conn = sqlite3.connect('users.db')
            c = conn.cursor()
            c.execute("INSERT INTO users (username, subscription, password) VALUES (?, 'free', ?)",
                      (username, password))
            conn.commit()
            conn.close()
            return redirect(url_for('dashboard'))
        return render_template('signup.html', error="Please enter a password!")
    return render_template('signup.html')

@app.route('/login_password', methods=['GET', 'POST'])
def login_password():
    if 'username' not in session:
        return redirect(url_for('index'))
    username = session['username']

    if request.method == 'POST':
        password = request.form.get('password', '')
        conn = sqlite3.connect('users.db')
        c = conn.cursor()
        c.execute("SELECT password, subscription FROM users WHERE username=?", (username,))
        user = c.fetchone()
        conn.close()
        
        if user is None:
            return render_template('login.html', error="User not found!")
        db_password, subscription = user
        if password == db_password:
            if subscription == 'premium':
                return redirect(url_for('premium_dashboard'))
            return redirect(url_for('dashboard'))
        return render_template('login.html', error="Incorrect password!")
    return render_template('login.html')

@app.route('/dashboard')
@login_required
def dashboard():
    username = session['username']
    conn = sqlite3.connect('users.db')
    c = conn.cursor()
    c.execute("SELECT subscription FROM users WHERE username=?", (username,))
    user = c.fetchone()
    conn.close()
    if user and user[0] == 'premium':
        return redirect(url_for('premium_dashboard'))
    return render_template('dashboard.html', name=username)

@app.route('/free_workouts')
@login_required
def free_workouts():
    username = session['username']
    return render_template('free_workouts.html', name=username)

@app.route('/premium_dashboard')
@login_required
def premium_dashboard():
    username = session['username']
    conn = sqlite3.connect('users.db')
    c = conn.cursor()
    c.execute("SELECT subscription FROM users WHERE username=?", (username,))
    user = c.fetchone()
    conn.close()
    if not user or user[0] != 'premium':
        return redirect(url_for('dashboard'))
    return render_template('premium_dashboard.html', name=username)

@app.route('/admin', methods=['GET', 'POST'])
@login_required
def admin():
    if session['username'] != 'admin':
        return redirect(url_for('index'))
    username = session['username']

    conn = sqlite3.connect('users.db')
    c = conn.cursor()
    
    if request.method == 'POST':
        if 'add_user' in request.form:
            new_username = request.form.get('new_username')
            new_password = request.form.get('new_password')
            new_subscription = request.form.get('new_subscription')
            try:
                c.execute("INSERT INTO users (username, subscription, password) VALUES (?, ?, ?)",
                          (new_username, new_subscription, new_password))
                conn.commit()
            except sqlite3.IntegrityError:
                return render_template('admin.html', error=f"Username {new_username} already exists!")
        elif 'update_user' in request.form:
            user_to_update = request.form.get('username')
            new_subscription = request.form.get('subscription')
            c.execute("UPDATE users SET subscription=? WHERE username=?", (new_subscription, user_to_update))
            conn.commit()

    c.execute("SELECT username, subscription FROM users")
    users = c.fetchall()
    conn.close()
    return render_template('admin.html', users=users)

@app.route('/profile')
@login_required
def profile():
    username = session['username']
    conn = sqlite3.connect('users.db')
    c = conn.cursor()
    c.execute("SELECT subscription, username, gender, weight, height, blood_type, muscle_mass, bmi FROM users WHERE username=?", (username,))
    user = c.fetchone()
    c.execute("SELECT type, data, timestamp FROM saved_data WHERE username=? ORDER BY timestamp DESC", (username,))
    saved_items = c.fetchall()
    conn.close()

    if user:
        profile_data = {
            'name': user[1],
            'subscription': user[0],
            'email': None,
            'gender': user[2],
            'weight': user[3],
            'height': user[4],
            'blood_type': user[5],
            'muscle_mass': user[6],
            'bmi': user[7]
        }
        return render_template('profile.html', profile_data=profile_data, saved_items=saved_items)
    return redirect(url_for('index'))

@app.route('/edit_profile', methods=['GET', 'POST'])
@login_required
def edit_profile():
    username = session['username']

    if request.method == 'POST':
        gender = request.form.get('gender')
        weight = float(request.form.get('weight', 0)) if request.form.get('weight') else None
        height = float(request.form.get('height', 0)) if request.form.get('height') else None
        blood_type = request.form.get('blood_type')
        muscle_mass = float(request.form.get('muscle_mass', 0)) if request.form.get('muscle_mass') else None
        bmi = round(weight / ((height / 100) ** 2), 1) if weight and height else None

        conn = sqlite3.connect('users.db')
        c = conn.cursor()
        c.execute("""UPDATE users SET gender=?, weight=?, height=?, blood_type=?, muscle_mass=?, bmi=?
                     WHERE username=?""", (gender, weight, height, blood_type, muscle_mass, bmi, username))
        conn.commit()
        conn.close()
        return redirect(url_for('profile'))

    conn = sqlite3.connect('users.db')
    c = conn.cursor()
    c.execute("SELECT gender, weight, height, blood_type, muscle_mass FROM users WHERE username=?", (username,))
    user = c.fetchone()
    conn.close()
    return render_template('edit_profile.html', name=username, gender=user[0], weight=user[1], height=user[2],
                           blood_type=user[3], muscle_mass=user[4])

@app.route('/generate_workout', methods=['POST'])
@login_required
def generate_workout():
    username = session['username']
    muscle_or_split = request.form.get('muscle_or_split')  # Handles both muscle groups and splits
    training_type = request.form.get('training_type')
    conn = sqlite3.connect('users.db')
    c = conn.cursor()
    c.execute("SELECT subscription FROM users WHERE username=?", (username,))
    user = c.fetchone()
    conn.close()
    subscription = user[0] if user else 'free'
    print(f"Generating workout for {username}, muscle/split: {muscle_or_split}, type: {training_type}, sub: {subscription}")

    if not muscle_or_split or not training_type:
        return jsonify({'error': f'Hey {username}, please provide all details!'})

    try:
        variations = workouts[muscle_or_split][training_type]
        if subscription == 'free':
            selected_program = variations[0][:1]  # First variation, first exercise only for free
            workout_text = f"<b>Hey {username}, Free Tier Workout:</b><br><br>Upgrade to Premium for 600+ options!<br><br>"
        else:
            selected_program = random.choice(variations)
            workout_text = f"<b>Hey {username}, your Premium Workout (600+ Options):</b><br><br>"

        for exercise in selected_program:
            workout_text += (
                f"<b>{exercise['name']}</b><br>Sets: {exercise['sets']}, Reps: {exercise['reps']}<br>"
                f"Note: {exercise['note']}<br><br>"
            )
        return jsonify({'workout': workout_text})
    except KeyError:
        return jsonify({'error': f'Sorry {username}, no data for {muscle_or_split} - {training_type}!'})

@app.route('/blood_test_analysis', methods=['GET', 'POST'])
@login_required
def blood_test_analysis():
    username = session['username']
    conn = sqlite3.connect('users.db')
    c = conn.cursor()
    c.execute("SELECT subscription FROM users WHERE username=?", (username,))
    user = c.fetchone()
    conn.close()
    if not user or user[0] != 'premium':
        return redirect(url_for('index'))

    if request.method == 'POST':
        action = request.form.get('action')
        if action == 'save' and 'response' in request.form:
            response = request.form['response']
            timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            conn = sqlite3.connect('users.db')
            c = conn.cursor()
            c.execute("INSERT INTO saved_data (username, type, data, timestamp) VALUES (?, ?, ?, ?)",
                      (username, 'blood_test', response, timestamp))
            conn.commit()
            conn.close()
            return jsonify({'message': 'Blood test analysis saved, my dude!'})

        if not check_api_limit(username):
            return jsonify({'response': "Yo, you’ve hit your daily chat limit—chill out till tomorrow, champ!"})

        message = request.form.get('message', '')
        file = request.files.get('file')
        combined_message = ""
        if file:
            try:
                file_content = file.read().decode('utf-8', errors='ignore')
                combined_message = f"Analyze this blood test: {file_content}"
            except Exception as e:
                return jsonify({'response': f"Whoops, couldn’t read that file—tech gremlins! (Error: {str(e)})"})
        if message:
            combined_message = f"{message}\n{combined_message}" if combined_message else message

        if not combined_message:
            return jsonify({'response': "Yo, give me something—text or a file, what’s up?"})

        if not is_blood_test_related(combined_message):
            return jsonify({'response': "Yo, this ain’t about blood tests—hit up Nutrition for diet vibes!"})

        headers = {
            'Authorization': f'Bearer {XAI_API_KEY}',
            'Content-Type': 'application/json'
        }
        payload = {
            'model': 'grok-beta',
            'messages': [
                {'role': 'system', 'content': 'You’re Grok, built by xAI—keep it chill, witty, and analyze blood tests from a functional medicine perspective when given data. Explain what each test measures, spot issues, and give actionable recs. Stick to blood test analysis only.'},
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
            return jsonify({'response': f"Whoa, hit a snag—tech gremlins at work! (Error: {str(e)})"})

    return render_template('blood_test_analysis.html', name=username)

@app.route('/chat', methods=['GET', 'POST'])
@login_required
def chat():
    username = session['username']
    conn = sqlite3.connect('users.db')
    c = conn.cursor()
    c.execute("SELECT subscription FROM users WHERE username=?", (username,))
    user = c.fetchone()
    conn.close()
    if not user or user[0] != 'premium':
        return redirect(url_for('index'))

    if request.method == 'POST':
        if not check_api_limit(username):
            return jsonify({'response': "Yo, you’ve hit your daily chat limit—chill out till tomorrow, champ!"})

        message = request.form.get('message', '')
        file = request.files.get('file')
        combined_message = ""
        if file:
            try:
                file_content = file.read().decode('utf-8', errors='ignore')
                combined_message = f"Here’s some info: {file_content}"
            except Exception as e:
                return jsonify({'response': f"Whoops, couldn’t read that file—tech gremlins! (Error: {str(e)})"})
        if message:
            combined_message = f"{message}\n{combined_message}" if combined_message else message

        if not combined_message:
            return jsonify({'response': "Yo, give me something—text or a file, what’s up?"})

        headers = {
            'Authorization': f'Bearer {XAI_API_KEY}',
            'Content-Type': 'application/json'
        }
        payload = {
            'model': 'grok-beta',
            'messages': [
                {'role': 'system', 'content': 'You’re Grok, built by xAI—keep it chill, witty, and helpful. Answer questions or analyze files as needed, but redirect blood test stuff to /blood_test_analysis and nutrition to /nutrition.'},
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
            return jsonify({'response': f"Whoa, hit a snag—tech gremlins at work! (Error: {str(e)})"})

    return render_template('chat_with_grok.html', name=username)

@app.route('/nutrition', methods=['GET', 'POST'])
@login_required
def nutrition():
    username = session['username']
    conn = sqlite3.connect('users.db')
    c = conn.cursor()
    c.execute("SELECT subscription, gender, weight, height, nutrition_goal, nutrition_restrictions FROM users WHERE username=?", (username,))
    user = c.fetchone()
    conn.close()
    if not user or user[0] != 'premium':
        return redirect(url_for('index'))

    if request.method == 'POST':
        action = request.form.get('action')
        if action == 'save' and 'response' in request.form:
            response = request.form['response']
            timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            conn = sqlite3.connect('users.db')
            c = conn.cursor()
            c.execute("INSERT INTO saved_data (username, type, data, timestamp) VALUES (?, ?, ?, ?)",
                      (username, 'nutrition', response, timestamp))
            conn.commit()
            conn.close()
            return jsonify({'message': 'Nutrition plan saved, fam!'})

        if not check_api_limit(username):
            return jsonify({'response': "Yo, you’ve hit your daily chat limit—chill out till tomorrow, champ!"})

        message = request.form.get('message', '')
        file = request.files.get('file')
        user_data = {
            'gender': user[1] or 'Male',
            'weight': user[2] or 70.0,
            'height': user[3] or 170.0,
            'nutrition_goal': user[4] or 'Maintenance',
            'nutrition_restrictions': user[5] or 'None'
        }

        combined_message = ""
        if file:
            try:
                file_content = file.read().decode('utf-8', errors='ignore')
                combined_message = f"Additional info from file: {file_content}"
            except Exception as e:
                return jsonify({'response': f"Whoops, couldn’t read that file—tech gremlins! (Error: {str(e)})"})
        if message:
            combined_message = f"{message}\n{combined_message}" if combined_message else message

        if not combined_message:
            combined_message = "Hey, give me a nutrition plan based on my profile!"

        if is_blood_test_related(combined_message) and not is_nutrition_related(combined_message):
            return jsonify({'response': "Hey, this looks like blood test stuff—take it to Blood Test Analysis!"})
        elif not is_nutrition_related(combined_message):
            return jsonify({'response': "Yo, this ain’t about nutrition—hit up Chat with Grok for other vibes!"})

        headers = {
            'Authorization': f'Bearer {XAI_API_KEY}',
            'Content-Type': 'application/json'
        }
        payload = {
            'model': 'grok-beta',
            'messages': [
                {'role': 'system', 'content': f'You’re Grok, built by xAI—keep it chill, witty, and recommend detailed nutrition plans based on user profile data (gender, weight, height, goals, restrictions). User profile: {user_data}\nHit me with your diet goals—I’ll hook you up with calories, macros, and sample meals. Nutrition only!'},
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
            return jsonify({'response': f"Whoa, hit a snag—tech gremlins at work! (Error: {str(e)})"})

    return render_template('nutrition.html', name=username)

@app.route('/nutrition_plan', methods=['GET', 'POST'])
@login_required
def nutrition_plan():
    username = session['username']
    conn = sqlite3.connect('users.db')
    c = conn.cursor()
    c.execute("SELECT subscription, gender, weight, height, nutrition_goal, nutrition_restrictions FROM users WHERE username=?", (username,))
    user = c.fetchone()
    conn.close()
    if not user or user[0] != 'premium':
        return redirect(url_for('index'))

    if request.method == 'POST' and request.form.get('action') == 'new':
        return redirect(url_for('nutrition'))

    gender = user[1] or 'Male'
    goal = user[4] or 'Weight Loss'
    restrictions = user[5] or ''
    try:
        plan = nutrition_plans[gender][goal][restrictions]
        return render_template('nutrition_plan.html', name=username, plan=plan, goal=goal, restrictions=restrictions)
    except KeyError:
        return render_template('nutrition_plan.html', name=username, error="No plan available for your selections. Try chatting with Grok!")

@app.route('/health_news')
@login_required
def health_news():
    username = session['username']
    conn = sqlite3.connect('users.db')
    c = conn.cursor()
    c.execute("SELECT subscription FROM users WHERE username=?", (username,))
    user = c.fetchone()
    conn.close()
    if not user or user[0] != 'premium':
        return redirect(url_for('index'))

    news_items = [
        {'title': 'Protein Boosts Gains', 'summary': 'New study says more protein = more muscle.', 'source': 'ScienceDaily', 'source_url': 'https://www.sciencedaily.com', 'image_url': 'https://via.placeholder.com/150'},
        {'title': 'Keto vs. Paleo', 'summary': 'Which diet reigns supreme? Spoiler: It’s complicated.', 'source': 'HealthLine', 'source_url': 'https://www.healthline.com', 'image_url': 'https://via.placeholder.com/150'}
    ]
    return render_template('health_news.html', name=username, news_items=news_items)

@app.route('/subscribe', methods=['GET', 'POST'])
@login_required
def subscribe():
    username = session['username']
    if request.method == 'POST':
        plan = request.form['plan']
        if not stripe:
            return render_template('subscribe.html', error="Stripe not configured!")
        try:
            if plan == 'monthly':
                price_id = 'price_monthly_id'  # Replace with real Stripe Price ID
            elif plan == 'yearly':
                price_id = 'price_yearly_id'  # Replace with real Stripe Price ID

            checkout_session = stripe.checkout.Session.create(
                payment_method_types=['card'],
                line_items=[{'price': price_id, 'quantity': 1}],
                mode='subscription',
                success_url=url_for('success', _external=True),
                cancel_url=url_for('subscribe', _external=True)
            )
            return redirect(checkout_session.url, code=303)
        except Exception as e:
            return render_template('subscribe.html', error=str(e))
    return render_template('subscribe.html')

@app.route('/success')
@login_required
def success():
    username = session['username']
    conn = sqlite3.connect('users.db')
    c = conn.cursor()
    c.execute("UPDATE users SET subscription='premium' WHERE username=?", (username,))
    conn.commit()
    conn.close()
    return render_template('success.html', name=username)

@x_auth.tokengetter
def get_x_oauth_token():
    return session.get('x_token')

if __name__ == '__main__':
    app.run(debug=False, host='0.0.0.0', port=5000)  # Disabled debug for production