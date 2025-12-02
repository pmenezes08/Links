"""
Simple Flask app to serve the landing page.
Used for www.c-point.co
"""
from flask import Flask, send_from_directory, redirect
import os

app = Flask(__name__, static_folder='landing/dist')

# Serve the landing page
@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')

# Serve static assets
@app.route('/assets/<path:filename>')
def assets(filename):
    return send_from_directory(os.path.join(app.static_folder, 'assets'), filename)

# Serve other static files (favicon, robots.txt, etc.)
@app.route('/<path:filename>')
def static_files(filename):
    # Check if file exists in landing/dist
    filepath = os.path.join(app.static_folder, filename)
    if os.path.isfile(filepath):
        return send_from_directory(app.static_folder, filename)
    # If not found, redirect to index (SPA fallback)
    return send_from_directory(app.static_folder, 'index.html')

# Serve .well-known files for Apple Universal Links
@app.route('/.well-known/<path:filename>')
def well_known(filename):
    well_known_dir = os.path.join(os.path.dirname(__file__), 'static', '.well-known')
    return send_from_directory(well_known_dir, filename)

# Redirect /app routes to app.c-point.co
@app.route('/login')
@app.route('/signup')
@app.route('/communities')
def redirect_to_app():
    from flask import request
    return redirect(f'https://app.c-point.co{request.path}')

if __name__ == '__main__':
    app.run(debug=True, port=8080)
