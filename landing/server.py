"""
Simple Flask app to serve the landing page static files.
"""
from flask import Flask, send_from_directory, redirect, request
import os

app = Flask(__name__)
DIST_DIR = "/app/dist"
APP_DOMAIN = "https://app.c-point.co"

@app.route("/")
@app.route("/privacy")
@app.route("/terms")
@app.route("/support")
def landing_pages():
    if request.path == "/" and request.args.get("invite"):
        return redirect(f"{APP_DOMAIN}/?{request.query_string.decode()}")
    return send_from_directory(DIST_DIR, "index.html")

@app.route("/assets/<path:filename>")
def assets(filename):
    response = send_from_directory(os.path.join(DIST_DIR, "assets"), filename)
    if filename.endswith(".js"):
        response.headers["Content-Type"] = "application/javascript"
    elif filename.endswith(".css"):
        response.headers["Content-Type"] = "text/css"
    return response

@app.route("/login")
@app.route("/signup")
def redirect_auth():
    query = f"?{request.query_string.decode()}" if request.query_string else ""
    return redirect(f"{APP_DOMAIN}{request.path}{query}")

@app.route("/<path:filename>")
def static_files(filename):
    filepath = os.path.join(DIST_DIR, filename)
    if os.path.isfile(filepath):
        return send_from_directory(DIST_DIR, filename)
    return send_from_directory(DIST_DIR, "index.html")

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)
