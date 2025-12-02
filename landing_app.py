"""
Simple Flask app to serve the landing page.
Used for www.c-point.co

All webapp routes are redirected to app.c-point.co
"""
from flask import Flask, send_from_directory, redirect, request
import os

app = Flask(__name__, static_folder='landing/dist')

APP_DOMAIN = 'https://app.c-point.co'

# Serve the landing page
@app.route('/')
def index():
    # Check if there's an invite parameter - redirect to app
    if request.args.get('invite'):
        return redirect(f'{APP_DOMAIN}/?{request.query_string.decode()}')
    return send_from_directory(app.static_folder, 'index.html')

# Serve static assets
@app.route('/assets/<path:filename>')
def assets(filename):
    return send_from_directory(os.path.join(app.static_folder, 'assets'), filename)

# Serve .well-known files for Apple Universal Links
@app.route('/.well-known/<path:filename>')
def well_known(filename):
    well_known_dir = os.path.join(os.path.dirname(__file__), 'static', '.well-known')
    return send_from_directory(well_known_dir, filename)

# Redirect ALL webapp routes to app.c-point.co
# Login and signup (with invite links)
@app.route('/login')
@app.route('/signup')
def redirect_auth():
    query = f'?{request.query_string.decode()}' if request.query_string else ''
    return redirect(f'{APP_DOMAIN}{request.path}{query}')

# Community routes
@app.route('/communities')
@app.route('/community_feed_react/<int:community_id>')
@app.route('/community/<int:community_id>')
@app.route('/community/<int:community_id>/<path:subpath>')
def redirect_communities(community_id=None, subpath=None):
    query = f'?{request.query_string.decode()}' if request.query_string else ''
    return redirect(f'{APP_DOMAIN}{request.path}{query}')

# User routes
@app.route('/profile')
@app.route('/profile/<path:subpath>')
@app.route('/messages')
@app.route('/notifications')
@app.route('/settings')
def redirect_user_routes(subpath=None):
    query = f'?{request.query_string.decode()}' if request.query_string else ''
    return redirect(f'{APP_DOMAIN}{request.path}{query}')

# Post routes
@app.route('/post/<int:post_id>')
@app.route('/post_detail/<int:post_id>')
def redirect_posts(post_id):
    query = f'?{request.query_string.decode()}' if request.query_string else ''
    return redirect(f'{APP_DOMAIN}{request.path}{query}')

# API routes (in case someone hits www instead of app)
@app.route('/api/<path:subpath>', methods=['GET', 'POST', 'PUT', 'DELETE'])
def redirect_api(subpath):
    query = f'?{request.query_string.decode()}' if request.query_string else ''
    return redirect(f'{APP_DOMAIN}/api/{subpath}{query}')

# Catch-all for other static files
@app.route('/<path:filename>')
def static_files(filename):
    # Check if file exists in landing/dist
    filepath = os.path.join(app.static_folder, filename)
    if os.path.isfile(filepath):
        return send_from_directory(app.static_folder, filename)
    # If not found, redirect to app (might be an app route)
    query = f'?{request.query_string.decode()}' if request.query_string else ''
    return redirect(f'{APP_DOMAIN}/{filename}{query}')

if __name__ == '__main__':
    app.run(debug=True, port=8080)
