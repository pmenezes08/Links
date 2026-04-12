"""Onboarding-related routes (React shell, debug tools, helpers)."""

from __future__ import annotations

import json
import logging
import os
import threading
from datetime import datetime

from functools import wraps

from flask import (
    Blueprint,
    abort,
    current_app,
    jsonify,
    redirect,
    render_template,
    request,
    send_from_directory,
    session,
    url_for,
)

from backend.services.database import get_db_connection, get_sql_placeholder
from redis_cache import invalidate_user_cache
from backend.services.firestore_writes import merge_onboarding_identity_to_steve_profile

onboarding_bp = Blueprint("onboarding", __name__)
logger = logging.getLogger(__name__)

XAI_API_KEY = os.getenv('XAI_API_KEY', '')
GROK_MODEL_FAST = 'grok-3-mini-fast-beta'


def _login_required(view_func):
    """Simple login_required decorator that avoids circular imports."""

    @wraps(view_func)
    def wrapper(*args, **kwargs):
        if "username" not in session:
            try:
                current_app.logger.info("No username in session for %s, redirecting to login", request.path)
            except Exception:
                pass
            return redirect(url_for("auth.login"))
        return view_func(*args, **kwargs)

    return wrapper


@onboarding_bp.route("/onboarding")
@_login_required
def onboarding_react():
    logger = current_app.logger
    try:
        try:
            logger.info(
                "Serving /onboarding for user=%s referer=%s",
                session.get("username"),
                request.headers.get("Referer"),
            )
        except Exception:
            pass
        dist_dir = os.path.join(current_app.root_path, "client", "dist")
        resp = send_from_directory(dist_dir, "index.html")
        try:
            resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            resp.headers["Pragma"] = "no-cache"
            resp.headers["Expires"] = "0"
        except Exception:
            pass
        return resp
    except Exception as exc:
        logger.error("Error serving React onboarding: %s", exc)
        abort(500)


@onboarding_bp.route("/debug_onboarding")
@_login_required
def debug_onboarding():
    """Debug endpoint to inspect onboarding trigger conditions."""
    from bodybuilding_app import get_db_connection  # pylint: disable=import-outside-toplevel

    username = session["username"]
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            c.execute(
                """
                SELECT u.email_verified, u.email_verified_at,
                       p.profile_picture
                FROM users u
                LEFT JOIN user_profiles p ON u.username = p.username
                WHERE u.username = ?
                """,
                (username,),
            )
            user = c.fetchone()

            c.execute(
                """
                SELECT COUNT(*) as cnt
                FROM user_communities uc
                JOIN users u ON uc.user_id = u.id
                WHERE u.username = ?
                """,
                (username,),
            )
            communities_row = c.fetchone()
            communities_count = (
                communities_row["cnt"]
                if hasattr(communities_row, "keys")
                else communities_row[0]
            )

            email_verified = bool(user["email_verified"] if hasattr(user, "keys") else user[0]) if user else False
            email_verified_at = (user["email_verified_at"] if hasattr(user, "keys") else user[1]) if user else None
            profile_picture = (user["profile_picture"] if hasattr(user, "keys") else user[2]) if user else None

            is_recently_verified = False
            time_since_verification = None
            if email_verified_at:
                try:
                    verified_time = datetime.fromisoformat(email_verified_at)  # type: ignore[name-defined]
                    diff = datetime.now() - verified_time  # type: ignore[name-defined]
                    time_since_verification = f"{diff.total_seconds() / 3600:.1f} hours ago"
                    is_recently_verified = diff.total_seconds() < 24 * 60 * 60
                except Exception:
                    time_since_verification = "Error parsing timestamp"

            should_trigger = (
                email_verified
                and communities_count == 0
                and not profile_picture
                and (is_recently_verified or not email_verified_at)
            )

            html = f"""
            <!DOCTYPE html>
            <html>
            <head>
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Onboarding Debug</title>
                <style>
                    body {{
                        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
                        padding: 20px;
                        background: #0b0b0b;
                        color: #fff;
                        line-height: 1.6;
                    }}
                    .status {{
                        padding: 15px;
                        margin: 10px 0;
                        border-radius: 8px;
                        border: 1px solid rgba(255,255,255,0.1);
                    }}
                    .pass {{ background: rgba(76, 175, 80, 0.2); border-color: #4CAF50; }}
                    .fail {{ background: rgba(244, 67, 54, 0.2); border-color: #F44336; }}
                    .label {{ font-weight: 600; color: #4db6ac; }}
                    h1 {{ color: #4db6ac; font-size: 24px; }}
                    .value {{ font-family: monospace; }}
                    .refresh {{
                        display: inline-block;
                        margin-top: 20px;
                        padding: 12px 24px;
                        background: #4db6ac;
                        color: #000;
                        text-decoration: none;
                        border-radius: 8px;
                        font-weight: 600;
                    }}
                </style>
            </head>
            <body>
                <h1>🔍 Onboarding Debug for {username}</h1>

                <div class="status {'pass' if email_verified else 'fail'}">
                    <div class="label">Email Verified:</div>
                    <div class="value">{'✅ YES' if email_verified else '❌ NO'}</div>
                </div>

                <div class="status {'pass' if email_verified_at else 'fail'}">
                    <div class="label">Email Verified At:</div>
                    <div class="value">{email_verified_at or '❌ NULL (timestamp missing!)'}</div>
                    {f'<div style="margin-top:8px; color:#9fb0b5;">{time_since_verification}</div>' if time_since_verification else ''}
                </div>

                <div class="status {'pass' if is_recently_verified else 'fail'}">
                    <div class="label">Recently Verified (< 24h):</div>
                    <div class="value">{'✅ YES' if is_recently_verified else '❌ NO'}</div>
                </div>

                <div class="status {'pass' if communities_count == 0 else 'fail'}">
                    <div class="label">Communities Count:</div>
                    <div class="value">{communities_count} {'✅ (needs to be 0)' if communities_count == 0 else '❌ (has communities)'}</div>
                </div>

                <div class="status {'pass' if not profile_picture else 'fail'}">
                    <div class="label">Has Profile Picture:</div>
                    <div class="value">{'❌ YES (has picture)' if profile_picture else '✅ NO (no picture)'}</div>
                    {f'<div style="margin-top:8px; color:#9fb0b5;">{profile_picture}</div>' if profile_picture else ''}
                </div>

                <div style="margin-top: 30px; padding: 20px; background: rgba(77, 182, 172, 0.1); border-radius: 8px; border: 2px solid {'#4CAF50' if should_trigger else '#F44336'};">
                    <div class="label">Should Onboarding Trigger?</div>
                    <div style="font-size: 32px; margin-top: 10px;">
                        {('✅ YES' if should_trigger else '❌ NO')}
                    </div>
                    <div style="margin-top: 15px; font-size: 14px; color: #9fb0b5;">
                        Requirements:<br>
                        • Email verified: {'✅' if email_verified else '❌'}<br>
                        • No communities: {'✅' if communities_count == 0 else '❌'}<br>
                        • No profile picture: {'✅' if not profile_picture else '❌'}<br>
                        • Recently verified OR no timestamp: {'✅' if (is_recently_verified or not email_verified_at) else '❌'}
                    </div>
                </div>

                <div style="margin-top: 30px; padding: 20px; background: rgba(255, 193, 7, 0.1); border-radius: 8px; border: 1px solid #FFC107;">
                    <div class="label" style="color: #FFC107;">⚠️ LocalStorage Check</div>
                    <div style="margin-top: 10px; font-size: 14px; color: #9fb0b5;">
                        Check your browser's localStorage for:<br>
                        <code style="background: rgba(255,255,255,0.1); padding: 4px 8px; border-radius: 4px; display: inline-block; margin-top: 8px;">
                            onboarding_done:{username}
                        </code><br><br>
                        If this is set to "1", onboarding won't trigger!<br>
                        <a href="/clear_onboarding_storage" style="display: inline-block; margin-top: 12px; padding: 10px 20px; background: #F44336; color: #fff; border: none; border-radius: 6px; font-weight: 600; cursor: pointer;">
                            Clear Onboarding Flag & Reload
                        </a>
                        <button onclick="clearOnboarding()" style="margin-top: 12px; margin-left: 10px; padding: 10px 20px; background: #666; color: #fff; border: none; border-radius: 6px; font-weight: 600; cursor: pointer;">
                            Try JavaScript Method
                        </button>
                    </div>
                </div>

                <a href="/debug_onboarding" class="refresh">🔄 Refresh</a>
                <a href="/premium_dashboard" class="refresh" style="background: #333; margin-left: 10px;">Go to Dashboard</a>

                <script>
                    const currentUsername = '{username}';

                    function clearOnboarding() {{
                        try {{
                            localStorage.removeItem('onboarding_done:' + currentUsername);
                            localStorage.removeItem('onboarding_done');
                            localStorage.removeItem('first_login_seen:' + currentUsername);

                            Object.keys(localStorage).forEach(function(key) {{
                                if (key.startsWith('onboarding_') || key.startsWith('first_login_')) {{
                                    localStorage.removeItem(key);
                                }}
                            }});

                            alert('✅ All onboarding flags cleared! Redirecting to dashboard...');
                            window.location.href = '/premium_dashboard';
                        }} catch(e) {{
                            alert('Error: ' + e.message);
                        }}
                    }}

                    window.addEventListener('DOMContentLoaded', function() {{
                        try {{
                            const doneValue = localStorage.getItem('onboarding_done:' + currentUsername);
                            const legacyValue = localStorage.getItem('onboarding_done');
                            const firstLoginValue = localStorage.getItem('first_login_seen:' + currentUsername);

                            if (doneValue || legacyValue || firstLoginValue) {{
                                const warning = document.createElement('div');
                                warning.style = 'position: fixed; top: 20px; left: 50%; transform: translateX(-50%); background: #F44336; color: #fff; padding: 15px 20px; border-radius: 8px; z-index: 9999; box-shadow: 0 4px 12px rgba(0,0,0,0.3); max-width: 90%; text-align: center;';
                                warning.innerHTML = '🚨 FOUND: localStorage blocking onboarding!<br><br>' +
                                    'onboarding_done:' + currentUsername + ' = ' + (doneValue || 'null') + '<br>' +
                                    'onboarding_done = ' + (legacyValue || 'null') + '<br>' +
                                    'first_login_seen:' + currentUsername + ' = ' + (firstLoginValue || 'null') + '<br><br>' +
                                    'Click \"Clear Onboarding Flag\" button below!';
                                document.body.appendChild(warning);
                            }}
                        }} catch(e) {{
                            console.error('localStorage check error:', e);
                        }}
                    }});
                </script>
            </body>
            </html>
            """
            return html
    except Exception as exc:
        return (
            f"<html><body style='padding:20px; font-family:sans-serif;'><h1>Error</h1><pre>{str(exc)}</pre></body></html>",
            500,
        )


@onboarding_bp.route("/clear_onboarding_storage", methods=["GET", "POST"])
def clear_onboarding_storage():
    """Return HTML+JS that clears onboarding-related localStorage keys."""
    destination = url_for("premium_dashboard") if "username" in session else url_for("auth.signup")
    return f'''
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Clearing...</title>
    </head>
    <body style="background: #0b0b0b; color: #fff; font-family: sans-serif; padding: 20px; text-align: center;">
        <h1>Clearing localStorage...</h1>
        <p id="status">Please wait...</p>
        <script>
            try {{
                const keys = Object.keys(localStorage);
                let cleared = [];

                keys.forEach(function(key) {{
                    if (key.includes('onboarding') || key.includes('first_login')) {{
                        localStorage.removeItem(key);
                        cleared.push(key);
                    }}
                }});

                if (cleared.length > 0) {{
                    document.getElementById('status').innerHTML =
                        '✅ Cleared ' + cleared.length + ' keys:<br><br>' +
                        cleared.join('<br>') +
                        '<br><br>Redirecting in 2 seconds...';
                }} else {{
                    document.getElementById('status').innerHTML =
                        '✅ No onboarding flags found to clear.<br><br>Redirecting in 2 seconds...';
                }}

                setTimeout(function() {{
                    window.location.href = '{destination}';
                }}, 2000);
            }} catch(e) {{
                document.getElementById('status').innerHTML =
                    '❌ Error: ' + e.message + '<br><br><a href="{destination}" style="color: #4db6ac;">Continue</a>';
            }}
        </script>
    </body>
    </html>
    '''


@onboarding_bp.route("/onboarding/welcome")
@_login_required
def onboarding_welcome():
    """Serve onboarding welcome step."""
    try:
        username = session.get("username")
        return render_template("onboarding_welcome.html", username=username)
    except Exception as exc:
        current_app.logger.error("onboarding_welcome error: %s", exc)
        return redirect(url_for("dashboard"))


# ── Conversational Onboarding API ────────────────────────────────────────


def _get_firestore_client():
    try:
        from google.cloud.firestore import Client
        return Client()
    except Exception:
        return None


@onboarding_bp.route("/api/onboarding/state", methods=["GET"])
@_login_required
def get_onboarding_state():
    """Return persisted onboarding conversation state from Firestore,
    plus a profile_complete flag based on SQL profile data."""
    username = session["username"]

    profile_complete = False
    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            c.execute(f"""
                SELECT u.first_name, u.last_name, u.role, u.company,
                       u.country, u.city, p.bio
                FROM users u LEFT JOIN user_profiles p ON u.username = p.username
                WHERE u.username = {ph}
            """, (username,))
            row = c.fetchone()
            if row:
                vals = [row[i] if not hasattr(row, 'keys') else list(row.values())[i] for i in range(7)]
                filled = sum(1 for v in vals if v and str(v).strip())
                profile_complete = filled >= 4
    except Exception as e:
        logger.warning(f"Profile completeness check failed for {username}: {e}")

    try:
        db = _get_firestore_client()
        if not db:
            return jsonify({"success": True, "state": None, "profileComplete": profile_complete})
        doc = db.collection("steve_onboarding").document(username).get()
        if doc.exists:
            return jsonify({"success": True, "state": doc.to_dict(), "profileComplete": profile_complete})
        return jsonify({"success": True, "state": None, "profileComplete": profile_complete})
    except Exception as e:
        logger.warning(f"Failed to get onboarding state for {username}: {e}")
        return jsonify({"success": True, "state": None, "profileComplete": profile_complete})


@onboarding_bp.route("/api/onboarding/state", methods=["POST"])
@_login_required
def save_onboarding_state():
    """Persist onboarding conversation state to Firestore."""
    username = session["username"]
    data = request.get_json(silent=True) or {}
    try:
        db = _get_firestore_client()
        if db:
            db.collection("steve_onboarding").document(username).set({
                "stage": data.get("stage", "welcome"),
                "collected": data.get("collected", {}),
                "messages": data.get("messages", [])[-30:],
                "updated_at": datetime.utcnow().isoformat(),
            }, merge=True)
        try:
            merge_onboarding_identity_to_steve_profile(username, data.get("collected") or {})
        except Exception as merge_err:
            logger.warning(f"onboardingIdentity sync failed for {username}: {merge_err}")
        return jsonify({"success": True})
    except Exception as e:
        logger.warning(f"Failed to save onboarding state for {username}: {e}")
        return jsonify({"success": True})


@onboarding_bp.route("/api/onboarding/redirect", methods=["POST"])
@_login_required
def onboarding_redirect_message():
    """Handle off-script user messages during onboarding. Returns a natural Steve redirect."""
    if not XAI_API_KEY:
        return jsonify({"success": True, "message": "That's a great question! Let's finish setting up your profile first, then I can help with that."})

    data = request.get_json(silent=True) or {}
    user_message = (data.get("message") or "").strip()
    stage = data.get("stage", "")
    question = data.get("currentQuestion", "")

    if not user_message:
        return jsonify({"success": True, "message": "Let's keep going!"})

    try:
        from openai import OpenAI
        client = OpenAI(api_key=XAI_API_KEY, base_url="https://api.x.ai/v1")
        response = client.chat.completions.create(
            model=GROK_MODEL_FAST,
            messages=[
                {"role": "system", "content": (
                    "You are Steve, a friendly AI assistant helping a new user set up their CPoint profile. "
                    f'The user is currently on the "{stage}" step where you asked: "{question}". '
                    "They said something off-topic. Respond naturally in 1-2 sentences, acknowledge what they said, "
                    "then gently steer them back to the question. Be warm and conversational, not robotic. "
                    "Do NOT answer the off-topic question in detail — just redirect."
                )},
                {"role": "user", "content": user_message},
            ],
            max_tokens=150,
            temperature=0.7,
        )
        msg = (response.choices[0].message.content or "").strip()
        if not msg:
            msg = "Interesting! Let's come back to that later. For now, let's finish getting you set up."
        return jsonify({"success": True, "message": msg})
    except Exception as e:
        logger.warning(f"Onboarding redirect LLM error: {e}")
        return jsonify({"success": True, "message": "Great thought! Let's finish setting up your profile first, then we can chat about anything."})


@onboarding_bp.route("/api/onboarding/resolve_role", methods=["POST"])
@_login_required
def onboarding_resolve_role():
    """Parse a free-text professional description into role and company."""
    data = request.get_json(silent=True) or {}
    text = (data.get("text") or "").strip()
    if not text:
        return jsonify({"success": False, "error": "No text provided"}), 400

    if not XAI_API_KEY:
        return jsonify({"success": True, "role": text, "company": ""})

    try:
        from openai import OpenAI
        client = OpenAI(api_key=XAI_API_KEY, base_url="https://api.x.ai/v1")
        response = client.chat.completions.create(
            model=GROK_MODEL_FAST,
            messages=[
                {"role": "system", "content": (
                    "You are a job title parser. Given a free-text description of someone's professional role, "
                    "extract the job title/role and the company name (if mentioned). "
                    "Return ONLY a JSON object with exactly two keys: \"role\" (the job title) and \"company\" (the company name, or empty string if not mentioned). "
                    "Examples:\n"
                    "- 'Product Manager at Google' -> {\"role\": \"Product Manager\", \"company\": \"Google\"}\n"
                    "- 'CEO Google' -> {\"role\": \"CEO\", \"company\": \"Google\"}\n"
                    "- 'Founder, building in fintech' -> {\"role\": \"Founder\", \"company\": \"\"}\n"
                    "- 'Program Manager @ Google' -> {\"role\": \"Program Manager\", \"company\": \"Google\"}\n"
                    "- 'Software Engineer - Meta' -> {\"role\": \"Software Engineer\", \"company\": \"Meta\"}\n"
                    "- 'I work in consulting' -> {\"role\": \"Consultant\", \"company\": \"\"}\n"
                    "Return ONLY the JSON, nothing else."
                )},
                {"role": "user", "content": text},
            ],
            max_tokens=80,
            temperature=0,
        )
        raw = (response.choices[0].message.content or "").strip()
        import json as _json
        parsed = _json.loads(raw)
        return jsonify({
            "success": True,
            "role": parsed.get("role", text),
            "company": parsed.get("company", ""),
        })
    except Exception as e:
        logger.warning(f"resolve_role error: {e}")
        return jsonify({"success": True, "role": text, "company": ""})


@onboarding_bp.route("/api/onboarding/resolve_location", methods=["POST"])
@_login_required
def onboarding_resolve_location():
    """Infer city/country from free-text location input.
    Returns {city, country, type} where type is:
      - 'city_and_country': both resolved
      - 'country_only': input is a country name, need city
      - 'unrecognized': input not recognized
    """
    data = request.get_json(silent=True) or {}
    text = (data.get("city") or data.get("text") or "").strip()
    if not text:
        return jsonify({"success": False, "error": "No location provided"}), 400

    from bodybuilding_app import get_cached_countries
    try:
        known_countries = get_cached_countries()
        country_names = [c["name"] for c in known_countries if c.get("name")]
    except Exception:
        country_names = []

    text_lower = text.lower()
    matched_country = next(
        (c for c in country_names if c.lower() == text_lower),
        None,
    )
    if matched_country:
        return jsonify({
            "success": True,
            "city": "",
            "country": matched_country,
            "type": "country_only",
        })

    if not XAI_API_KEY:
        return jsonify({"success": True, "city": text, "country": "", "type": "unrecognized"})

    try:
        from openai import OpenAI
        client = OpenAI(api_key=XAI_API_KEY, base_url="https://api.x.ai/v1")
        country_hint = ", ".join(country_names[:30]) + "..." if country_names else ""
        response = client.chat.completions.create(
            model=GROK_MODEL_FAST,
            messages=[
                {"role": "system", "content": (
                    "You are a geography lookup tool. Given a location input, determine the city and country. "
                    "Return ONLY a JSON object with three keys: "
                    "\"city\" (properly capitalized city name), "
                    "\"country\" (full country name), "
                    "\"type\" (one of: \"city_and_country\", \"country_only\", \"unrecognized\"). "
                    "If the input is clearly a country (e.g. 'Germany', 'Brazil'), return type='country_only' with empty city. "
                    "If the input is a recognizable city, return type='city_and_country' with the city and its country. "
                    "If the input is gibberish or not a real place, return type='unrecognized'. "
                    f"Known countries for validation: {country_hint}"
                    "\nReturn ONLY the JSON, nothing else."
                )},
                {"role": "user", "content": text},
            ],
            max_tokens=80,
            temperature=0,
        )
        raw = (response.choices[0].message.content or "").strip()
        import json as _json
        parsed = _json.loads(raw)
        resolved_country = parsed.get("country", "")
        if resolved_country and country_names:
            best = next(
                (c for c in country_names if c.lower() == resolved_country.lower()),
                None,
            )
            if best:
                resolved_country = best
        return jsonify({
            "success": True,
            "city": parsed.get("city", ""),
            "country": resolved_country,
            "type": parsed.get("type", "city_and_country" if parsed.get("city") else "unrecognized"),
        })
    except Exception as e:
        logger.warning(f"resolve_location error: {e}")
        return jsonify({"success": True, "city": text, "country": "", "type": "unrecognized"})


@onboarding_bp.route("/api/onboarding/compose_bio", methods=["POST"])
@_login_required
def onboarding_compose_bio():
    """Compose a polished identity paragraph from the user's onboarding answers. Personal first, professional second."""
    data = request.get_json(silent=True) or {}
    talk_all_day = (data.get("talk_all_day") or "").strip()
    recommend = (data.get("recommend") or "").strip()
    reach_out = (data.get("reach_out") or "").strip()
    journey = (data.get("journey") or "").strip()
    role = (data.get("role") or "").strip()
    company = (data.get("company") or "").strip()
    city = (data.get("city") or "").strip()
    country = (data.get("country") or "").strip()
    existing_bio = (data.get("existing_bio") or "").strip()

    if not talk_all_day and not recommend and not reach_out and not journey:
        return jsonify({"success": False, "error": "No answers provided"}), 400

    if not XAI_API_KEY:
        parts = []
        if talk_all_day:
            parts.append(f"I could talk all day about {talk_all_day.lower()}.")
        if journey:
            parts.append(f"What shaped how I show up today: {journey}.")
        if recommend:
            parts.append(f"Currently recommending: {recommend}.")
        if role:
            parts.append(f"{role}{' at ' + company if company else ''}.")
        if reach_out:
            parts.append(f"Reach out about {reach_out.lower()}.")
        new_text = " ".join(parts)
        if existing_bio and new_text:
            return jsonify({"success": True, "bio": f"{existing_bio} {new_text}"})
        if existing_bio and not new_text:
            return jsonify({"success": True, "bio": existing_bio})
        return jsonify({"success": True, "bio": new_text})

    try:
        from openai import OpenAI
        client = OpenAI(api_key=XAI_API_KEY, base_url="https://api.x.ai/v1")

        location = f"{city}, {country}".strip(', ') if city else ""
        professional = ""
        if role and company:
            professional = f"They work as {role} at {company}."
        elif role:
            professional = f"Their role is {role}."

        journey_text = f"Highlight from their journey: {journey}" if journey else ""
        existing_block = (
            f"Their current public profile bio (preserve accurate facts and voice unless new answers clearly replace them):\n{existing_bio}\n\n"
            if existing_bio
            else ""
        )

        response = client.chat.completions.create(
            model=GROK_MODEL_FAST,
            messages=[
                {"role": "system", "content": (
                    "You are an identity writer for a networking platform. Compose a polished, engaging 2-4 sentence personal identity paragraph. "
                    "PERSONAL comes first — who they are as a person, their passions, what makes them interesting. "
                    "PROFESSIONAL comes second — their role is context, not the headline. "
                    "If an existing public bio is provided, weave it together with the new onboarding answers into one coherent whole — "
                    "do not drop important specifics from the old bio unless they clearly contradict new information. "
                    "Write in first person. Be authentic and human — not corporate or generic. "
                    "Do NOT use hashtags, emojis, or buzzwords. Just clean, compelling prose. "
                    "Return ONLY the identity text, nothing else."
                )},
                {"role": "user", "content": (
                    existing_block
                    + f"New details from onboarding:\n"
                    f"Things they could talk about all day: {talk_all_day}\n"
                    f"They recommend: {recommend}\n"
                    f"They want people to reach out about: {reach_out}\n"
                    f"{journey_text}\n"
                    f"{professional}\n"
                    f"{'Based in ' + location if location else ''}\n\n"
                    "Write their unified identity:"
                )},
            ],
            max_tokens=200,
            temperature=0.7,
        )
        bio = (response.choices[0].message.content or "").strip().strip('"')
        if not bio:
            return jsonify({"success": False, "error": "Empty response"}), 500
        return jsonify({"success": True, "bio": bio})
    except Exception as e:
        logger.warning(f"compose_bio LLM error: {e}")
        parts = []
        if talk_all_day:
            parts.append(f"I could talk all day about {talk_all_day.lower()}.")
        if journey:
            parts.append(f"What shaped how I show up today: {journey}.")
        if recommend:
            parts.append(f"Currently recommending: {recommend}.")
        if role:
            parts.append(f"{role}{' at ' + company if company else ''}.")
        if reach_out:
            parts.append(f"Reach out about {reach_out.lower()}.")
        new_text = " ".join(parts)
        if existing_bio and new_text:
            return jsonify({"success": True, "bio": f"{existing_bio} {new_text}"})
        if existing_bio and not new_text:
            return jsonify({"success": True, "bio": existing_bio})
        return jsonify({"success": True, "bio": new_text})


@onboarding_bp.route("/api/onboarding/enrich", methods=["POST"])
@_login_required
def onboarding_enrich_profile():
    """Trigger AI profile enrichment during onboarding. Returns enrichment results."""
    username = session["username"]
    try:
        from bodybuilding_app import (
            _build_profile_text_for_grok,
            _analyze_profile_with_grok,
            _fetch_onboarding_identity_context,
            _fetch_user_communities,
            _fetch_user_recent_activity,
            _migrate_analysis_to_v3,
        )
        from backend.services.firestore_reads import get_steve_user_profile
        from backend.services.steve_content_enrichment import enrich_shared_activity_for_profile
        from backend.services.steve_profiling_gates import (
            collect_social_links_for_profiling,
            format_user_provided_social_block,
        )

        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()
            c.execute(f"""
                SELECT u.username, u.first_name, u.last_name, u.email,
                       u.role, u.company, u.industry, u.linkedin,
                       u.professional_about, u.professional_interests,
                       u.city, u.country, u.gender, u.date_of_birth,
                       u.degree, u.school, u.skills, u.experience,
                       p.display_name, p.bio, p.location
                FROM users u
                LEFT JOIN user_profiles p ON u.username = p.username
                WHERE u.username = {ph}
            """, (username,))
            row = c.fetchone()
            if not row:
                return jsonify({"success": False, "error": "User not found"}), 404

        existing_profile = get_steve_user_profile(username)
        existing_analysis_pre = _migrate_analysis_to_v3((existing_profile or {}).get("analysis", {})) or {}

        def _gv_row(key: str) -> str:
            try:
                val = row[key] if hasattr(row, "keys") else None
                return (str(val).strip() if val else "")
            except Exception:
                return ""

        allow_norm, social_rows = collect_social_links_for_profiling(
            linkedin_sql=_gv_row("linkedin"),
            firestore_profile=existing_profile or {},
            existing_analysis=existing_analysis_pre,
        )

        communities = _fetch_user_communities(username)
        onboarding_context = _fetch_onboarding_identity_context(username)
        activity = _fetch_user_recent_activity(username)
        profile_text = _build_profile_text_for_grok(
            row,
            communities=communities,
            activity=activity,
            onboarding_context=onboarding_context,
        )
        _social_block = format_user_provided_social_block(social_rows)
        if _social_block:
            profile_text = profile_text + "\n\n" + _social_block

        profiling_external_sources_payload = None
        try:
            from datetime import datetime as _dt

            enrich_block, ingest_errors, external_sources = enrich_shared_activity_for_profile(
                activity or {}, "standard", allowlist_normalized=allow_norm
            )
            profiling_external_sources_payload = {
                "updatedAt": _dt.utcnow().isoformat() + "Z",
                "items": external_sources,
            }
            if enrich_block:
                profile_text = profile_text + "\n\n" + enrich_block
            if ingest_errors:
                profile_text += (
                    "\n\n--- CONTENT INGESTION FAILURES (factual; do not invent content for these URLs) ---\n"
                )
                for row_e in ingest_errors:
                    profile_text += f"- {row_e.get('url', '')}: {row_e.get('error', '')}\n"
        except Exception as enrich_err:
            logger.warning("Onboarding enrichment content ingest skipped: %s", enrich_err)

        analysis = _analyze_profile_with_grok(username, profile_text, depth="standard")

        if not analysis:
            return jsonify({"success": True, "enrichment": None})

        # Save to Firestore (steve_user_profiles — the canonical collection)
        from backend.services.firestore_writes import write_steve_user_profile
        if existing_profile and existing_profile.get("analysis"):
            from bodybuilding_app import _merge_analyses, _get_steve_profiling_write_payloads

            merged = _merge_analyses(existing_profile.get("analysis", {}), analysis)
            _wk = dict(_get_steve_profiling_write_payloads(username))
            if profiling_external_sources_payload is not None:
                _wk["profiling_external_sources"] = profiling_external_sources_payload
            write_steve_user_profile(username, analysis=merged, **_wk)
        else:
            try:
                from bodybuilding_app import _get_steve_profiling_write_payloads

                _wk = dict(_get_steve_profiling_write_payloads(username))
                if profiling_external_sources_payload is not None:
                    _wk["profiling_external_sources"] = profiling_external_sources_payload
                write_steve_user_profile(username, analysis=analysis, **_wk)
            except Exception:
                if profiling_external_sources_payload is not None:
                    write_steve_user_profile(
                        username,
                        analysis=analysis,
                        profiling_external_sources=profiling_external_sources_payload,
                    )
                else:
                    write_steve_user_profile(username, analysis=analysis)

        # Extract review cards for the user
        cards = _build_review_cards(analysis)
        return jsonify({"success": True, "enrichment": cards})

    except Exception as e:
        logger.error(f"Onboarding enrichment error for {username}: {e}")
        return jsonify({"success": True, "enrichment": None})


def _build_review_cards(analysis: dict) -> list:
    """Extract reviewable enrichment cards from a Grok analysis for onboarding review."""
    cards = []
    pro = analysis.get("professional") or {}

    company = pro.get("company") or {}
    role = pro.get("role") or {}
    if company.get("name") or role.get("title"):
        label = ""
        if role.get("title") and company.get("name"):
            label = f"{role['title']} at {company['name']}"
        elif company.get("name"):
            label = f"Works at {company['name']}"
        elif role.get("title"):
            label = role["title"]
        detail = ""
        if company.get("description"):
            detail = company["description"]
        if company.get("sector"):
            detail += f" ({company['sector']})" if detail else company["sector"]
        cards.append({"id": "current_role", "section": "professional", "label": label, "detail": detail, "field": "role_company"})

    career = pro.get("careerHistory") or []
    if len(career) > 1:
        past = [e for e in career if not (e.get("period", "").endswith("present"))][:5]
        if past:
            lines = []
            for e in past:
                line = f"{e.get('role', '?')} at {e.get('company', '?')}"
                if e.get("duration"):
                    line += f" ({e['duration']})"
                lines.append(line)
            cards.append({"id": "career_history", "section": "professional", "label": "Career History", "detail": " → ".join(lines), "field": "career"})

    if pro.get("education"):
        cards.append({"id": "education", "section": "professional", "label": "Education", "detail": pro["education"], "field": "education"})

    loc = pro.get("location") or {}
    if loc.get("context"):
        cards.append({"id": "location_context", "section": "professional", "label": "Location", "detail": loc["context"], "field": "location"})

    if pro.get("webFindings"):
        cards.append({"id": "web_findings", "section": "professional", "label": "Professional Background", "detail": pro["webFindings"][:300], "field": "web_summary"})

    personal = analysis.get("personal") or {}
    if personal.get("interests") and isinstance(personal["interests"], list):
        cards.append({"id": "personal_interests", "section": "personal", "label": "Interests", "detail": ", ".join(personal["interests"][:8]), "field": "interests"})

    if personal.get("lifestyle"):
        cards.append({"id": "lifestyle", "section": "personal", "label": "Personal", "detail": personal["lifestyle"], "field": "lifestyle"})

    summary = analysis.get("summary", "")
    if summary:
        cards.append({"id": "summary", "section": "identity", "label": "About You", "detail": summary, "field": "summary"})

    return cards


@onboarding_bp.route("/api/onboarding/save_field", methods=["POST"])
@_login_required
def onboarding_save_field():
    """Save a single profile field during onboarding. Supports first_name, last_name, display_name, role, company, city, country, linkedin, bio."""
    username = session["username"]
    data = request.get_json(silent=True) or {}
    field = data.get("field", "")
    value = (data.get("value") or "").strip()

    if not field:
        return jsonify({"success": False, "error": "No field specified"}), 400

    try:
        with get_db_connection() as conn:
            c = conn.cursor()
            ph = get_sql_placeholder()

            user_fields = {"first_name", "last_name", "role", "company", "industry", "linkedin", "city", "country"}
            profile_fields = {"display_name", "bio"}
            # journey is stored only in onboarding state (not in main profile table)

            if field in user_fields:
                c.execute(f"UPDATE users SET {field} = {ph} WHERE username = {ph}", (value, username))
                conn.commit()
            elif field in profile_fields:
                c.execute(f"SELECT username FROM user_profiles WHERE username = {ph}", (username,))
                exists = c.fetchone()
                if exists:
                    c.execute(f"UPDATE user_profiles SET {field} = {ph}, updated_at = CURRENT_TIMESTAMP WHERE username = {ph}", (value, username))
                else:
                    c.execute(f"INSERT INTO user_profiles (username, {field}) VALUES ({ph}, {ph})", (username, value))
                conn.commit()
            else:
                return jsonify({"success": False, "error": f"Unknown field: {field}"}), 400

        try:
            invalidate_user_cache(username)
        except Exception:
            pass
        return jsonify({"success": True})
    except Exception as e:
        logger.error(f"Onboarding save_field error for {username}: {e}")
        return jsonify({"success": False, "error": "Failed to save"}), 500


@onboarding_bp.route("/api/onboarding/social_links", methods=["POST"])
@_login_required
def onboarding_save_social_links():
    """Persist optional Instagram/TikTok/Snapchat URLs to Firestore (onboardingIdentity.socialProvidedLinks)."""
    username = session["username"]
    data = request.get_json(silent=True) or {}
    links = data.get("socialProvidedLinks")
    if not isinstance(links, list):
        return jsonify({"success": False, "error": "socialProvidedLinks must be a list"}), 400
    try:
        merge_onboarding_identity_to_steve_profile(username, {"socialProvidedLinks": links})
        return jsonify({"success": True})
    except Exception as e:
        logger.error("onboarding_save_social_links error for %s: %s", username, e)
        return jsonify({"success": False, "error": "Failed to save"}), 500


@onboarding_bp.route("/api/onboarding/complete", methods=["POST"])
@_login_required
def onboarding_complete():
    """Mark onboarding as complete. Trigger background profile analysis if not already done."""
    username = session["username"]
    try:
        db = _get_firestore_client()
        if db:
            doc_ref = db.collection("steve_onboarding").document(username)
            doc_ref.set({
                "stage": "complete",
                "completed_at": datetime.utcnow().isoformat(),
            }, merge=True)
            try:
                snap = doc_ref.get()
                collected = (snap.to_dict() or {}).get("collected") or {}
                merge_onboarding_identity_to_steve_profile(username, collected)
            except Exception as merge_err:
                logger.warning(f"onboardingIdentity sync on complete failed for {username}: {merge_err}")

            # Trigger full Steve analysis in background (web_search, embedding, etc.)
            existing = db.collection("steve_user_profiles").document(username).get()
            if not existing.exists or not (existing.to_dict() or {}).get("analysis", {}).get("summary"):
                def _bg_analyze(uname):
                    try:
                        from bodybuilding_app import _execute_steve_profile_analysis, invalidate_steve_context_cache
                        ok, _payload, _err = _execute_steve_profile_analysis(uname, depth='standard', reset=False)
                        if ok:
                            try:
                                invalidate_steve_context_cache(uname)
                            except Exception:
                                pass
                        logger.info(f"Background onboarding analysis {'succeeded' if ok else 'failed'} for {uname}")
                    except Exception as bg_err:
                        logger.error(f"Background onboarding analysis error for {uname}: {bg_err}")

                threading.Thread(target=_bg_analyze, args=(username,), daemon=True).start()

        try:
            invalidate_user_cache(username)
        except Exception:
            pass
        return jsonify({"success": True})
    except Exception as e:
        logger.error(f"Onboarding complete error for {username}: {e}")
        return jsonify({"success": True})
