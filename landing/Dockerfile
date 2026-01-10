# Dockerfile for C-Point Landing Page (www.c-point.co)
# Deploys to Google Cloud Run

FROM python:3.11-slim

WORKDIR /app

# Install Flask
RUN pip install --no-cache-dir flask gunicorn

# Copy the built landing page
COPY dist /app/dist

# Create a simple Flask app to serve static files
RUN echo 'from flask import Flask, send_from_directory, redirect, request\n\
import os\n\
\n\
app = Flask(__name__, static_folder="/app/dist")\n\
DIST_DIR = "/app/dist"\n\
APP_DOMAIN = "https://app.c-point.co"\n\
\n\
@app.route("/")\n\
@app.route("/privacy")\n\
@app.route("/terms")\n\
@app.route("/support")\n\
def landing_pages():\n\
    if request.path == "/" and request.args.get("invite"):\n\
        return redirect(f"{APP_DOMAIN}/?{request.query_string.decode()}")\n\
    return send_from_directory(DIST_DIR, "index.html")\n\
\n\
@app.route("/assets/<path:filename>")\n\
def assets(filename):\n\
    response = send_from_directory(os.path.join(DIST_DIR, "assets"), filename)\n\
    if filename.endswith(".js"):\n\
        response.headers["Content-Type"] = "application/javascript"\n\
    elif filename.endswith(".css"):\n\
        response.headers["Content-Type"] = "text/css"\n\
    return response\n\
\n\
@app.route("/login")\n\
@app.route("/signup")\n\
def redirect_auth():\n\
    query = f"?{request.query_string.decode()}" if request.query_string else ""\n\
    return redirect(f"{APP_DOMAIN}{request.path}{query}")\n\
\n\
@app.route("/<path:filename>")\n\
def static_files(filename):\n\
    filepath = os.path.join(DIST_DIR, filename)\n\
    if os.path.isfile(filepath):\n\
        return send_from_directory(DIST_DIR, filename)\n\
    return send_from_directory(DIST_DIR, "index.html")\n\
\n\
if __name__ == "__main__":\n\
    app.run(host="0.0.0.0", port=8080)\n' > /app/server.py

# Expose port
EXPOSE 8080

# Run with gunicorn
CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "2", "--threads", "4", "server:app"]
