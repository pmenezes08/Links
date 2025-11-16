"""Onboarding-related routes (React shell, debug tools, helpers)."""

from __future__ import annotations

import os
from datetime import datetime

from flask import (
    Blueprint,
    abort,
    current_app,
    redirect,
    render_template,
    request,
    send_from_directory,
    session,
    url_for,
)


onboarding_bp = Blueprint("onboarding", __name__)


def _login_required(view_func):
    """Defer importing login_required to avoid circular imports."""
    from bodybuilding_app import login_required as _login_required  # pylint: disable=import-outside-toplevel

    return _login_required(view_func)


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
