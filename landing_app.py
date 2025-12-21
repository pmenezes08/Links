"""
Simple Flask app to serve the landing page.
Used for www.c-point.co

Landing pages are served from the React SPA.
App routes are redirected to app.c-point.co
"""
from flask import Flask, send_from_directory, redirect, request
import os

# Get the directory where this script is located
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DIST_DIR = os.path.join(BASE_DIR, 'landing', 'dist')

app = Flask(__name__, static_folder=DIST_DIR)

APP_DOMAIN = 'https://app.c-point.co'

# Landing page routes (served by React SPA)
LANDING_ROUTES = {'/', '/privacy', '/terms', '/support'}

# Serve the landing page and its routes
@app.route('/')
@app.route('/privacy')
@app.route('/terms')
@app.route('/support')
def landing_pages():
    # Check if there's an invite parameter on homepage - redirect to app
    if request.path == '/' and request.args.get('invite'):
        return redirect(f'{APP_DOMAIN}/?{request.query_string.decode()}')
    return send_from_directory(DIST_DIR, 'index.html')

# Serve static assets with correct MIME types
@app.route('/assets/<path:filename>')
def assets(filename):
    assets_dir = os.path.join(DIST_DIR, 'assets')
    response = send_from_directory(assets_dir, filename)
    # Ensure JavaScript files have correct MIME type for ES modules
    if filename.endswith('.js'):
        response.headers['Content-Type'] = 'application/javascript'
    elif filename.endswith('.css'):
        response.headers['Content-Type'] = 'text/css'
    return response

# Serve .well-known files for Apple Universal Links
@app.route('/.well-known/<path:filename>')
def well_known(filename):
    well_known_dir = os.path.join(BASE_DIR, 'static', '.well-known')
    return send_from_directory(well_known_dir, filename)

# Redirect webapp routes to app.c-point.co
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

# Catch-all for other paths
@app.route('/<path:filename>')
def static_files(filename):
    # Check if file exists in landing/dist (static files like favicon, robots.txt, etc.)
    filepath = os.path.join(DIST_DIR, filename)
    if os.path.isfile(filepath):
        return send_from_directory(DIST_DIR, filename)
    
    # For all other unknown routes, serve the React app (it will show 404 page)
    # This allows React Router to handle the 404 display
    return send_from_directory(DIST_DIR, 'index.html')

if __name__ == '__main__':
    app.run(debug=True, port=8080)
