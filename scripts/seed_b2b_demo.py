#!/usr/bin/env python3
"""Seed 4 B2B showcase communities (EN + PT) owned by Paulo, for website screenshots.

Communities (all fictional companies/schools; ~190 demo members with full profiles):
    Northbridge Alumni Network                     — 75 members, PAID L1 (EN)
    Riverside Running Club                         — 25 members, free   (EN)
    Alumni ENA — Escola de Negócios do Atlântico   — 75 membros, PAID L1 (PT)
    Corredores do Tejo                             — 25 membros, free   (PT)

Seeds everything the feed + owner dashboard read: users with full personal &
professional profiles and avatar photos, memberships with a realistic join
curve, posts, threaded replies, heart reactions, polls with votes, calendar
events with RSVPs, useful links, community feed visits, and pending invites.

Demo users are identified by email prefix ``demo_b2b_`` @c-point.co, avatars are
external randomuser.me portrait URLs (no R2 uploads), and paid state is marked
with ``sub_demo_b2b_*`` / ``stripe_mode='test'`` so nothing touches real Stripe.

Run (repo root; connects with the same pattern as scripts/seed_demo_communities.py)::

    # direct (public IP) — default host below
    python scripts/seed_b2b_demo.py --owner Paulo

    # dry-run: validates datasets offline, prints the plan, touches nothing
    python scripts/seed_b2b_demo.py --dry-run

Cleanup (removes every row this script created; never touches the owner)::

    python scripts/seed_b2b_demo.py --cleanup
"""

from __future__ import annotations

import argparse
import json
import os
import random
import secrets
import subprocess
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _REPO)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import seed_b2b_demo_data_en as EN  # noqa: E402
import seed_b2b_demo_data_pt as PT  # noqa: E402

PROJECT = "cpoint-127c2"
DEFAULT_HOST = os.environ.get("MYSQL_HOST", "34.78.168.84")
DEFAULT_PORT = os.environ.get("MYSQL_PORT", "3306")
DEFAULT_USER = os.environ.get("MYSQL_USER", "app_user")
DEFAULT_DB = os.environ.get("MYSQL_DB", "cpoint")
PASSWORD_SECRET = "mysql-password"

DEMO_EMAIL_PREFIX = "demo_b2b_"
DEMO_EMAIL_DOMAIN = "c-point.co"
DEMO_PASSWORD = "DemoMember123!"

NOW = datetime.now(timezone.utc)
RNG = random.Random(20260710)

COMMUNITY_BANNERS = {
    "en_alumni": "https://images.unsplash.com/photo-1523580494863-6f3031224c94?w=1600&q=80&auto=format&fit=crop",
    "en_running": "https://images.unsplash.com/photo-1552674605-db6ffd4facb5?w=1600&q=80&auto=format&fit=crop",
    "pt_alumni": "https://images.unsplash.com/photo-1585208798174-6cedd86e019a?w=1600&q=80&auto=format&fit=crop",
    "pt_running": "https://images.unsplash.com/photo-1571008887538-b36bb32f4571?w=1600&q=80&auto=format&fit=crop",
}
COMMUNITY_TZ = {"en": "Europe/London", "pt": "Europe/Lisbon"}
TZ_OFFSET_H = {"Europe/London": 1, "Europe/Lisbon": 1}  # July (DST)

PENDING_INVITES = {
    "en_alumni": ["j.harrington@alumni-mail.example.com", "c.beaumont@alumni-mail.example.com",
                  "wei.zhang@alumni-mail.example.com", "s.ferreira@alumni-mail.example.com",
                  "a.novak@alumni-mail.example.com"],
    "en_running": ["newrunner.jane@mail.example.com", "mark.hutton@mail.example.com"],
    "pt_alumni": ["c.varanda@mail-alumni.example.com", "h.figueira@mail-alumni.example.com",
                  "l.saraiva@mail-alumni.example.com", "d.quaresma@mail-alumni.example.com"],
    "pt_running": ["corredora.nova@mail.example.com", "vitor.paiva@mail.example.com"],
}


def ts(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def days_ago(n: float, hour: int | None = None, minute: int | None = None) -> str:
    dt = NOW - timedelta(days=n)
    if hour is not None:
        dt = dt.replace(hour=hour, minute=minute if minute is not None else RNG.randint(0, 59))
    if dt > NOW:  # hour override may not push a timestamp into the future
        dt = NOW - timedelta(minutes=RNG.uniform(3, 45))
    return ts(dt)


def fetch_password() -> str:
    if os.environ.get("MYSQL_PASSWORD"):
        return os.environ["MYSQL_PASSWORD"]
    cmd = ["gcloud", "secrets", "versions", "access", "latest",
           f"--secret={PASSWORD_SECRET}", f"--project={PROJECT}"]
    return subprocess.check_output(cmd, text=True, shell=(os.name == "nt")).strip()


def get_connection():
    import pymysql
    from pymysql.cursors import DictCursor
    return pymysql.connect(
        host=DEFAULT_HOST, port=int(DEFAULT_PORT), user=DEFAULT_USER,
        password=fetch_password(), database=DEFAULT_DB, charset="utf8mb4",
        autocommit=True, cursorclass=DictCursor, connect_timeout=15,
    )


def url_ok(url: str) -> bool:
    try:
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            return 200 <= resp.status < 400
    except Exception:
        return False


# ── Persona expansion ────────────────────────────────────────────────────

class AvatarAllocator:
    """EN uses portrait indexes 0-49, PT 50-99, per gender — no repeated faces."""

    def __init__(self, lang: str):
        base = 0 if lang == "en" else 50
        self.next_idx = {"m": base, "f": base}
        self.limit = base + 50

    def take(self, gender: str) -> str:
        idx = self.next_idx[gender]
        if idx >= self.limit:  # overflow safety: reuse from start of block
            idx = self.limit - 50 + RNG.randint(0, 49)
        else:
            self.next_idx[gender] += 1
        folder = "men" if gender == "m" else "women"
        return f"https://randomuser.me/api/portraits/{folder}/{idx}.jpg"


HIGHLIGHTS_EN = {
    "five_minutes": ["Coffee in hand, inbox zero attempt number 4,000.",
                     "Walking the long way to work — best thinking time of the day.",
                     "Reading something that has nothing to do with my job."],
    "outside_work": ["Mostly {i0}, with a side of {i1}.",
                     "{i0} and {i1} — in that order, depending on the weather.",
                     "You'll find me doing {i0} or planning the next trip."],
    "cpoint_goals": ["Stay close to the people I keep meaning to catch up with.",
                     "Give back to the network that opened doors for me.",
                     "Meet people outside my usual bubble."],
}
HIGHLIGHTS_PT = {
    "five_minutes": ["Café na mão, tentativa n.º 4000 de inbox zero.",
                     "Ir a pé pelo caminho mais longo — o melhor momento do dia para pensar.",
                     "A ler qualquer coisa que não tenha nada a ver com o trabalho."],
    "outside_work": ["Sobretudo {i0}, com uma dose de {i1}.",
                     "{i0} e {i1} — por esta ordem, dependendo do tempo.",
                     "Estou algures entre {i0} e a planear a próxima viagem."],
    "cpoint_goals": ["Ficar perto das pessoas com quem ando sempre a dizer que vou falar.",
                     "Retribuir à rede que me abriu portas.",
                     "Conhecer gente fora da minha bolha do costume."],
}


def build_full_user(username, first, last, gender, age, city, country, role, company,
                    industry, years, skills, degree, school, prev_role, prev_company,
                    interests, bio, lang, avatars, password_hash):
    start_year = 2026 - RNG.randint(1, 5)
    start_ym = f"{start_year}-{RNG.randint(1, 12):02d}"
    prev_start = f"{start_year - RNG.randint(2, 5)}-{RNG.randint(1, 12):02d}"
    grad_year = 2026 - max(2, years - RNG.randint(0, 3))
    hl = HIGHLIGHTS_EN if lang == "en" else HIGHLIGHTS_PT
    i0 = interests[0].lower()
    i1 = interests[1].lower() if len(interests) > 1 else i0
    dob = datetime(2026 - age, RNG.randint(1, 12), RNG.randint(1, 28))
    return {
        "username": username,
        "email": f"{DEMO_EMAIL_PREFIX}{username}@{DEMO_EMAIL_DOMAIN}",
        "password": password_hash,
        "first_name": first, "last_name": last,
        "gender": "Male" if gender == "m" else "Female",
        "age": age, "date_of_birth": dob.strftime("%Y-%m-%d"),
        "city": city, "country": country,
        "role": role, "company": company, "industry": industry,
        "degree": degree, "school": school,
        "skills": skills, "experience": years,
        "linkedin": f"https://www.linkedin.com/in/{username.replace('_', '-')}-demo",
        "professional_about": bio,
        "professional_interests": json.dumps(interests, ensure_ascii=False),
        "current_role_start_ym": start_ym,
        "professional_work_history": json.dumps([
            {"title": role, "company": company, "location": city,
             "start": start_ym, "end": "", "description": ""},
            {"title": prev_role, "company": prev_company, "location": city,
             "start": prev_start, "end": start_ym, "description": ""},
        ], ensure_ascii=False),
        "professional_education": json.dumps([
            {"school": school, "degree": degree,
             "start": f"{grad_year - 2}-09", "end": f"{grad_year}-06", "description": ""},
        ], ensure_ascii=False),
        "personal_highlight_answers": json.dumps({
            "five_minutes": RNG.choice(hl["five_minutes"]),
            "outside_work": RNG.choice(hl["outside_work"]).format(i0=i0, i1=i1),
            "cpoint_goals": RNG.choice(hl["cpoint_goals"]),
        }, ensure_ascii=False),
        "display_name": f"{first} {last}",
        "bio": bio,
        "location": f"{city}, {country}",
        "website": f"https://www.{company.lower().replace(' ', '').replace('&', 'e')[:18]}.example.com" if RNG.random() < 0.4 else None,
        "instagram": username.replace("_", ".") if RNG.random() < 0.35 else None,
        "profile_picture": avatars.take(gender),
        "created_days_ago": RNG.randint(45, 400),
    }


def expand_authors(mod, lang, avatars, password_hash):
    users = {}
    for row in mod.AUTHORS:
        u = build_full_user(*row, lang=lang, avatars=avatars, password_hash=password_hash)
        users[row[0]] = u
    return users


def make_fillers(mod, lang, count, kind, existing, avatars, password_hash, used_usernames):
    """Generate `count` filler members with complete profiles."""
    out = []
    gi = 0
    for n in range(count):
        gender = "m" if n % 2 == 0 else "f"
        firsts = mod.FILLER_FIRST_M if gender == "m" else mod.FILLER_FIRST_F
        while True:
            first = firsts[gi % len(firsts)]
            last = mod.FILLER_LAST[(gi * 7 + n) % len(mod.FILLER_LAST)]
            username = f"{first}_{last}".lower().replace("í", "i").replace("é", "e") \
                .replace("á", "a").replace("ã", "a").replace("ç", "c").replace("ó", "o") \
                .replace("ú", "u").replace("â", "a").replace("ê", "e").replace("õ", "o") \
                .replace("ü", "u").replace("-", "_")
            username = "".join(ch for ch in username if ch.isascii() and (ch.isalnum() or ch == "_"))
            gi += 1
            if username not in used_usernames:
                used_usernames.add(username)
                break
        if kind == "alumni":
            role, company, industry = mod.ALUMNI_FILLER_ROLES[n % len(mod.ALUMNI_FILLER_ROLES)]
            city = mod.ALUMNI_FILLER_CITIES[n % len(mod.ALUMNI_FILLER_CITIES)]
            degree, school = mod.ALUMNI_FILLER_DEGREES[n % len(mod.ALUMNI_FILLER_DEGREES)]
            year = RNG.randint(2004, 2024)
            focus = mod.ALUMNI_FILLER_FOCUS[n % len(mod.ALUMNI_FILLER_FOCUS)]
            bio = mod.ALUMNI_FILLER_BIOS[n % len(mod.ALUMNI_FILLER_BIOS)].format(
                year=year, role=role, company=company, city=city, focus=focus)
            interests = [focus.capitalize(), "Networking", "Travel" if lang == "en" else "Viagens"]
            skills = (f"{focus.capitalize()}, Stakeholder management, Analytics" if lang == "en"
                      else f"{focus.capitalize()}, Gestão de stakeholders, Analytics")
            prev_role, prev_company = ("Analyst" if lang == "en" else "Analista"), company
        else:
            role, company, industry = mod.RUNNING_FILLER_ROLES[n % len(mod.RUNNING_FILLER_ROLES)]
            city = mod.RUNNING_FILLER_CITIES[n % len(mod.RUNNING_FILLER_CITIES)]
            degree, school = ("BSc", city + " University") if lang == "en" else ("Licenciatura", "Universidade de Lisboa")
            year = RNG.randint(2019, 2026)
            goal = mod.RUNNING_FILLER_GOALS[n % len(mod.RUNNING_FILLER_GOALS)]
            bio = mod.RUNNING_FILLER_BIOS[n % len(mod.RUNNING_FILLER_BIOS)].format(
                year=year, role=role, city=city, goal=goal)
            interests = (["Running", "Coffee", "Podcasts"] if lang == "en"
                         else ["Corrida", "Café", "Podcasts"])
            skills = (f"{role}, Time management, First aid (hopefully unused)" if lang == "en"
                      else f"{role}, Gestão de tempo, Primeiros socorros (espera-se que sem uso)")
            prev_role, prev_company = role, company
        country = ("United Kingdom" if lang == "en" else "Portugal")
        if city in ("New York", "Boston", "Toronto"):
            country = "United States" if city != "Toronto" else "Canada"
        elif city in ("Paris",):
            country = "France"
        elif city in ("São Paulo",):
            country = "Brasil"
        elif city in ("Luanda",):
            country = "Angola"
        elif city in ("Maputo",):
            country = "Moçambique"
        elif city in ("Madrid",):
            country = "Espanha" if lang == "pt" else "Spain"
        u = build_full_user(username, first, last, gender, RNG.randint(24, 58), city, country,
                            role, company, industry, RNG.randint(2, 25),
                            skills, degree, school, prev_role, prev_company,
                            interests, bio, lang=lang, avatars=avatars, password_hash=password_hash)
        out.append(u)
    return out


# ── DB writers ───────────────────────────────────────────────────────────

def table_columns(c, table: str) -> set:
    c.execute(f"SHOW COLUMNS FROM {table}")
    return {row["Field"] for row in c.fetchall()}


def preflight_username_check(c, plans):
    """Abort BEFORE any write if a planned username belongs to a real user."""
    all_names = [u["username"] for p in plans for u in p["users"]]
    collisions = []
    for i in range(0, len(all_names), 100):
        chunk = all_names[i:i + 100]
        marks = ", ".join(["%s"] * len(chunk))
        c.execute(f"SELECT username, email FROM users WHERE username IN ({marks})", chunk)
        for row in c.fetchall():
            if not (row.get("email") or "").startswith(DEMO_EMAIL_PREFIX):
                collisions.append(row["username"])
    if collisions:
        raise SystemExit(
            "Username collision with REAL users (nothing was written): "
            f"{collisions}. Rename these personas in the data files and re-run.")


def resolve_owner(c, owner_arg: str) -> tuple[str, int]:
    c.execute("SELECT id, username FROM users WHERE LOWER(username) = LOWER(%s)", (owner_arg,))
    row = c.fetchone()
    if row:
        return row["username"], int(row["id"])
    c.execute("SELECT username FROM users WHERE username LIKE %s LIMIT 10", (f"%{owner_arg}%",))
    cands = [r["username"] for r in c.fetchall()]
    raise SystemExit(f"Owner '{owner_arg}' not found. Similar usernames: {cands or 'none'}. "
                     f"Re-run with --owner <exact_username>.")


def insert_user(c, u) -> int:
    c.execute("SELECT id, email FROM users WHERE username = %s", (u["username"],))
    row = c.fetchone()
    if row:
        if not (row.get("email") or "").startswith(DEMO_EMAIL_PREFIX):
            raise SystemExit(f"Username collision with a REAL user: {u['username']} — aborting, nothing else written. "
                             f"Rename this persona in the data file and re-run.")
        return int(row["id"])
    created = days_ago(u["created_days_ago"])
    c.execute(
        """INSERT INTO users (username, email, canonical_email, password, first_name, last_name,
               subscription, is_active, email_verified, email_verified_at, created_at,
               country, city, age, gender, date_of_birth,
               role, company, industry, degree, school, skills, linkedin, experience,
               professional_about, professional_interests, current_role_start_ym,
               professional_work_history, professional_education, personal_highlight_answers)
           VALUES (%s,%s,%s,%s,%s,%s,'free',1,1,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        (u["username"], u["email"], u["email"], u["password"], u["first_name"], u["last_name"],
         created, created,
         u["country"], u["city"], u["age"], u["gender"], u["date_of_birth"],
         u["role"], u["company"], u["industry"], u["degree"], u["school"], u["skills"],
         u["linkedin"], u["experience"],
         u["professional_about"], u["professional_interests"], u["current_role_start_ym"],
         u["professional_work_history"], u["professional_education"], u["personal_highlight_answers"]))
    uid = int(c.lastrowid)
    c.execute(
        """INSERT IGNORE INTO user_profiles (username, display_name, bio, location, website,
               instagram, profile_picture, is_public, created_at, updated_at)
           VALUES (%s,%s,%s,%s,%s,%s,%s,1,%s,%s)""",
        (u["username"], u["display_name"], u["bio"], u["location"], u["website"],
         u["instagram"], u["profile_picture"], created, created))
    return uid


def create_community(c, definition, owner_username, lang, parent_id=None) -> int:
    name = definition["name"]
    if parent_id is None:
        c.execute("SELECT id FROM communities WHERE name = %s", (name,))
    else:
        c.execute("SELECT id FROM communities WHERE name = %s AND parent_community_id = %s",
                  (name, parent_id))
    row = c.fetchone()
    if row:
        print(f"[seed] Community '{name}' already exists (id={row['id']}) — reusing")
        return int(row["id"])
    banner = COMMUNITY_BANNERS.get(definition["key"])
    if banner and not url_ok(banner):
        print(f"[seed] WARNING banner URL failed HEAD check, leaving empty: {banner}")
        banner = None
    join_code = secrets.token_urlsafe(8)[:12].upper()
    c.execute(
        """INSERT INTO communities (name, type, creator_username, join_code, tier, description,
               location, background_path, is_active, created_at, parent_community_id)
           VALUES (%s,'community',%s,%s,%s,%s,%s,%s,1,%s,%s)""",
        (name, owner_username, join_code,
         "paid_l1" if definition.get("paid_tier") == "L1" else "free",
         definition["description"], definition["location"], banner,
         days_ago(60 if parent_id is None else 45), parent_id))
    cid = int(c.lastrowid)
    if definition.get("paid_tier") == "L1":
        c.execute(
            """UPDATE communities SET stripe_subscription_id=%s, stripe_customer_id=%s,
                   subscription_status='active', billing_provider='stripe', stripe_mode='test',
                   current_period_end=%s, cancel_at_period_end=0, canceled_at=NULL
               WHERE id=%s""",
            (f"sub_demo_b2b_{definition['key']}", f"cus_demo_b2b_{definition['key']}",
             ts(NOW + timedelta(days=23)), cid))
    print(f"[seed] Created '{name}' (id={cid}, tier={'paid_l1' if definition.get('paid_tier') else 'free'})")
    return cid


def add_membership(c, cid, uid, role, joined_days_ago):
    c.execute(
        "INSERT IGNORE INTO user_communities (user_id, community_id, role, joined_at) VALUES (%s,%s,%s,%s)",
        (uid, cid, role, days_ago(joined_days_ago)))


def join_curve(n: int) -> list:
    """Joined_at spread: older core + steady growth + ~30% in the last 14 days."""
    out = []
    for i in range(n):
        r = RNG.random()
        if r < 0.35:
            out.append(RNG.uniform(45, 59))
        elif r < 0.70:
            out.append(RNG.uniform(14, 45))
        else:
            out.append(RNG.uniform(0.2, 14))
    return out


def seed_threads(c, cid, threads, users_by_name, owner_username, member_usernames, stats):
    def uname(key):
        return owner_username if key == "OWNER" else key

    for thread in sorted(threads, key=lambda t: -(t.get("post") or t.get("poll"))["days_ago"]):
        if "poll" in thread:
            p = thread["poll"]
            author = uname(p["author"])
            hour = RNG.randint(9, 20) if p["days_ago"] >= 1 else None
            c.execute("INSERT INTO posts (username, content, community_id, timestamp) VALUES (%s,%s,%s,%s)",
                      (author, f"📊 {p['question']}", cid, days_ago(p["days_ago"], hour)))
            post_id = int(c.lastrowid)
            stats["posts"] += 1
            c.execute("""INSERT INTO polls (post_id, question, created_by, is_active, single_vote, created_at)
                         VALUES (%s,%s,%s,1,1,%s)""",
                      (post_id, p["question"], author, days_ago(p["days_ago"], hour)))
            poll_id = int(c.lastrowid)
            option_ids = []
            for opt in p["options"]:
                c.execute("INSERT INTO poll_options (poll_id, option_text, votes) VALUES (%s,%s,0)", (poll_id, opt))
                option_ids.append(int(c.lastrowid))
            stats["polls"] += 1
            voters = RNG.sample(member_usernames, int(len(member_usernames) * RNG.uniform(0.55, 0.8)))
            weights = p["votes_weights"]
            for v in voters:
                opt = RNG.choices(option_ids, weights=weights)[0]
                c.execute("""INSERT IGNORE INTO poll_votes (poll_id, option_id, username, voted_at)
                             VALUES (%s,%s,%s,%s)""",
                          (poll_id, opt, v, days_ago(RNG.uniform(0, max(p["days_ago"] - 0.1, 0.1)))))
                if c.rowcount > 0:
                    c.execute("UPDATE poll_options SET votes = votes + 1 WHERE id = %s", (opt,))
                    stats["votes"] += 1
            hearts = RNG.sample(member_usernames, min(len(member_usernames), RNG.randint(4, 10)))
            for h in hearts:
                c.execute("INSERT IGNORE INTO reactions (post_id, username, reaction_type) VALUES (%s,%s,'heart')",
                          (post_id, h))
            stats["reactions"] += len(hearts)
            continue

        p = thread["post"]
        author = uname(p["author"])
        hour = RNG.randint(8, 20) if p["days_ago"] >= 1 else None
        c.execute("INSERT INTO posts (username, content, community_id, timestamp) VALUES (%s,%s,%s,%s)",
                  (author, p["content"], cid, days_ago(p["days_ago"], hour)))
        post_id = int(c.lastrowid)
        stats["posts"] += 1

        n_hearts = min(thread.get("hearts", 6), len(member_usernames))
        pool = [m for m in member_usernames if m != author]
        for h in RNG.sample(pool, min(n_hearts, len(pool))):
            c.execute("INSERT IGNORE INTO reactions (post_id, username, reaction_type) VALUES (%s,%s,'heart')",
                      (post_id, h))
        stats["reactions"] += n_hearts

        reply_ids = {}
        minute_bump = 0
        for i, r in enumerate(thread.get("replies", [])):
            if r["content"] == "__SKIP__":
                continue
            r_author = uname(r["author"])
            minute_bump += RNG.randint(6, 40)
            if r["days_ago"] >= 1 and hour is not None:
                r_ts = days_ago(r["days_ago"], min(hour + 1 + minute_bump // 60, 23), minute_bump % 60)
            else:
                r_ts = days_ago(r["days_ago"])
            parent_id = reply_ids.get(r["parent"]) if "parent" in r else None
            c.execute("""INSERT INTO replies (post_id, community_id, username, content, timestamp, parent_reply_id)
                         VALUES (%s,%s,%s,%s,%s,%s)""",
                      (post_id, cid, r_author, r["content"], r_ts, parent_id))
            reply_ids[i] = int(c.lastrowid)
            stats["replies"] += 1
            if RNG.random() < 0.5:
                for h in RNG.sample(pool, min(RNG.randint(1, 4), len(pool))):
                    c.execute("""INSERT IGNORE INTO reply_reactions (reply_id, username, reaction_type)
                                 VALUES (%s,%s,'heart')""", (reply_ids[i], h))
                    stats["reactions"] += 1


def seed_events(c, cid, events, owner_username, member_usernames, tz_name, stats):
    offset = TZ_OFFSET_H.get(tz_name, 0)
    for ev in events:
        start_local = (NOW + timedelta(days=ev["days_ahead"], hours=offset)).replace(
            hour=int(ev["time"][:2]), minute=int(ev["time"][3:5]), second=0)
        end_local = start_local + timedelta(hours=ev["duration_h"])
        start_utc = start_local - timedelta(hours=offset)
        end_utc = end_local - timedelta(hours=offset)
        c.execute(
            """INSERT INTO calendar_events (username, title, date, end_date, time, start_time, end_time,
                   description, location, community_id, timezone, notification_preferences,
                   created_at, starts_at_utc, ends_at_utc)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'all',%s,%s,%s)""",
            (owner_username, ev["title"], start_local.strftime("%Y-%m-%d"),
             end_local.strftime("%Y-%m-%d"), ev["time"], ts(start_local), ts(end_local),
             ev["description"], ev["location"], cid, tz_name,
             days_ago(RNG.uniform(3, 12)), ts(start_utc), ts(end_utc)))
        event_id = int(c.lastrowid)
        stats["events"] += 1
        pool = list(member_usernames)
        RNG.shuffle(pool)
        going = pool[:min(ev["rsvp_going"], len(pool))]
        maybe = pool[len(going):len(going) + min(ev["rsvp_maybe"], max(len(pool) - len(going), 0))]
        for uu, resp in [(u, "going") for u in going] + [(u, "maybe") for u in maybe]:
            c.execute("""INSERT IGNORE INTO event_rsvps (event_id, username, response, responded_at)
                         VALUES (%s,%s,%s,%s)""",
                      (event_id, uu, resp, (NOW - timedelta(days=RNG.uniform(0, 3))).isoformat()))
            stats["rsvps"] += 1


def seed_links(c, cid, links, owner_username, stats):
    for ln in links:
        c.execute("""INSERT INTO useful_links (community_id, group_id, username, url, description, created_at)
                     VALUES (%s,NULL,%s,%s,%s,%s)""",
                  (cid, owner_username, ln["url"], ln["description"], days_ago(RNG.uniform(2, 20))))
        stats["links"] += 1


def seed_visits(c, cid, member_usernames, stats):
    for i, u in enumerate(member_usernames):
        if RNG.random() < 0.15 and i > 5:  # ~15% quiet members
            continue
        n_visits = RNG.randint(6, 18) if i < 15 else RNG.randint(1, 8)
        for _ in range(n_visits):
            d = RNG.uniform(0, 30) ** 1.4 / (30 ** 0.4)  # skew towards recent days
            c.execute("""INSERT INTO community_visit_history (username, community_id, visit_time)
                         VALUES (%s,%s,%s)""", (u, cid, days_ago(d)))
            stats["visits"] += 1


def community_has_posts(c, cid) -> bool:
    c.execute("SELECT COUNT(*) AS n FROM posts WHERE community_id = %s", (cid,))
    return int(c.fetchone()["n"]) > 0


def community_has_invites(c, cid) -> bool:
    try:
        c.execute("SELECT COUNT(*) AS n FROM community_invitations WHERE community_id = %s", (cid,))
        return int(c.fetchone()["n"]) > 0
    except Exception:
        return True  # can't tell — don't risk duplicating


def seed_invites(c, cid, key, owner_username, stats):
    try:
        cols = table_columns(c, "community_invitations")
        for email in PENDING_INVITES.get(key, []):
            row = {"community_id": cid, "invited_email": email, "status": "pending",
                   "invited_at": days_ago(RNG.uniform(1, 10))}
            for cand in ("invited_by_username", "inviter_username", "invited_by", "inviter"):
                if cand in cols:
                    row[cand] = owner_username
            use = {k: v for k, v in row.items() if k in cols}
            fields = ", ".join(use)
            marks = ", ".join(["%s"] * len(use))
            c.execute(f"INSERT INTO community_invitations ({fields}) VALUES ({marks})", list(use.values()))
            stats["invites"] += 1
    except Exception as exc:  # non-critical metric
        print(f"[seed] WARNING could not seed pending invites: {exc}")


# ── Plans ────────────────────────────────────────────────────────────────

def build_language_plan(mod, lang, password_hash):
    avatars = AvatarAllocator(lang)
    authors = expand_authors(mod, lang, avatars, password_hash)
    used = set(authors)
    alumni_fill = make_fillers(mod, lang, mod.ALUMNI_COMMUNITY["members"] - 1 - len(mod.ALUMNI_AUTHORS),
                               "alumni", authors, avatars, password_hash, used)
    running_fill = make_fillers(mod, lang, mod.RUNNING_COMMUNITY["members"] - 1 - len(mod.RUNNING_AUTHORS),
                                "running", authors, avatars, password_hash, used)
    alumni_members = list(mod.ALUMNI_AUTHORS) + [u["username"] for u in alumni_fill]
    running_members = list(mod.RUNNING_AUTHORS) + [u["username"] for u in running_fill]
    all_users = list(authors.values()) + alumni_fill + running_fill

    subs = []
    for sub in mod.SUB_COMMUNITIES:
        members = list(sub["include_authors"])
        for m in alumni_members:
            if len(members) >= sub["members"] - 1:  # -1: owner counts too
                break
            if m not in members:
                members.append(m)
        subs.append({"def": sub, "members": members, "threads": sub["threads"]})

    return {
        "lang": lang, "users": all_users,
        "alumni": {"def": mod.ALUMNI_COMMUNITY, "members": alumni_members,
                   "threads": mod.ALUMNI_THREADS + mod.ALUMNI_FRESH_THREADS,
                   "events": mod.ALUMNI_EVENTS, "links": mod.ALUMNI_LINKS, "subs": subs},
        "running": {"def": mod.RUNNING_COMMUNITY, "members": running_members,
                    "threads": mod.RUNNING_THREADS + mod.RUNNING_FRESH_THREADS,
                    "events": mod.RUNNING_EVENTS, "links": mod.RUNNING_LINKS, "subs": []},
    }


def validate(plans):
    problems = []
    for plan in plans:
        usernames = {u["username"] for u in plan["users"]}
        for ckey in ("alumni", "running"):
            block = plan[ckey]
            expect = block["def"]["members"]
            got = 1 + len(block["members"])  # +1 owner
            if got != expect:
                problems.append(f"{block['def']['name']}: {got} members, expected {expect}")
            for sub in block["subs"]:
                sgot = 1 + len(sub["members"])
                if sgot != sub["def"]["members"]:
                    problems.append(f"{sub['def']['name']}: {sgot} members, expected {sub['def']['members']}")
                parent_set = set(block["members"])
                for m in sub["members"]:
                    if m not in parent_set:
                        problems.append(f"{sub['def']['name']}: member {m} not in parent community")
                for t in sub["threads"]:
                    body = t.get("post") or t.get("poll")
                    if body["author"] != "OWNER" and body["author"] not in usernames:
                        problems.append(f"{sub['def']['name']}: unknown author {body['author']}")
                    for r in t.get("replies", []):
                        if r["author"] != "OWNER" and r["author"] not in usernames:
                            problems.append(f"{sub['def']['name']}: unknown reply author {r['author']}")
            for t in block["threads"]:
                body = t.get("post") or t.get("poll")
                if body["author"] != "OWNER" and body["author"] not in usernames:
                    problems.append(f"{block['def']['name']}: unknown author {body['author']}")
                for r in t.get("replies", []):
                    if r["author"] != "OWNER" and r["author"] not in usernames and r["content"] != "__SKIP__":
                        problems.append(f"{block['def']['name']}: unknown reply author {r['author']}")
                if "poll" in t and abs(sum(t["poll"]["votes_weights"]) - 1.0) > 0.01:
                    problems.append(f"{block['def']['name']}: poll weights don't sum to 1")
            for m in block["members"]:
                if m not in usernames:
                    problems.append(f"{block['def']['name']}: member {m} has no user record")
    return problems


# ── Cleanup ──────────────────────────────────────────────────────────────

ALL_COMMUNITY_NAMES = ([EN.ALUMNI_COMMUNITY["name"], EN.RUNNING_COMMUNITY["name"],
                        PT.ALUMNI_COMMUNITY["name"], PT.RUNNING_COMMUNITY["name"]]
                       + [s["name"] for s in EN.SUB_COMMUNITIES]
                       + [s["name"] for s in PT.SUB_COMMUNITIES])


def cleanup(c):
    marks = ", ".join(["%s"] * len(ALL_COMMUNITY_NAMES))
    c.execute(f"SELECT id FROM communities WHERE name IN ({marks})", ALL_COMMUNITY_NAMES)
    cids = [r["id"] for r in c.fetchall()]
    if cids:  # include any children of ours not matched by name
        cm = ", ".join(["%s"] * len(cids))
        c.execute(f"SELECT id FROM communities WHERE parent_community_id IN ({cm})", cids)
        cids = sorted({*cids, *[r["id"] for r in c.fetchall()]})
    if cids:
        cm = ", ".join(["%s"] * len(cids))
        c.execute(f"SELECT id FROM calendar_events WHERE community_id IN ({cm})", cids)
        eids = [r["id"] for r in c.fetchall()]
        if eids:
            em = ", ".join(["%s"] * len(eids))
            c.execute(f"DELETE FROM event_rsvps WHERE event_id IN ({em})", eids)
        c.execute(f"DELETE FROM calendar_events WHERE community_id IN ({cm})", cids)
        c.execute(f"""DELETE pv FROM poll_votes pv JOIN polls p ON pv.poll_id=p.id
                      JOIN posts po ON p.post_id=po.id WHERE po.community_id IN ({cm})""", cids)
        c.execute(f"""DELETE po FROM poll_options po JOIN polls p ON po.poll_id=p.id
                      JOIN posts ps ON p.post_id=ps.id WHERE ps.community_id IN ({cm})""", cids)
        c.execute(f"""DELETE p FROM polls p JOIN posts po ON p.post_id=po.id
                      WHERE po.community_id IN ({cm})""", cids)
        c.execute(f"""DELETE rr FROM reply_reactions rr JOIN replies r ON rr.reply_id=r.id
                      WHERE r.community_id IN ({cm})""", cids)
        c.execute(f"""DELETE r FROM reactions r JOIN posts p ON r.post_id=p.id
                      WHERE p.community_id IN ({cm})""", cids)
        c.execute(f"DELETE FROM replies WHERE community_id IN ({cm})", cids)
        c.execute(f"DELETE FROM posts WHERE community_id IN ({cm})", cids)
        c.execute(f"DELETE FROM useful_links WHERE community_id IN ({cm})", cids)
        c.execute(f"DELETE FROM community_visit_history WHERE community_id IN ({cm})", cids)
        try:
            c.execute(f"DELETE FROM community_invitations WHERE community_id IN ({cm})", cids)
        except Exception:
            pass
        c.execute(f"DELETE FROM user_communities WHERE community_id IN ({cm})", cids)
        c.execute(f"DELETE FROM communities WHERE parent_community_id IN ({cm})", cids)
        c.execute(f"DELETE FROM communities WHERE id IN ({cm})", cids)
        print(f"[cleanup] Removed {len(cids)} communities and all their content")
    pattern = f"{DEMO_EMAIL_PREFIX}%@{DEMO_EMAIL_DOMAIN}"
    c.execute("SELECT username FROM users WHERE email LIKE %s", (pattern,))
    names = [r["username"] for r in c.fetchall()]
    if names:
        um = ", ".join(["%s"] * len(names))
        c.execute(f"DELETE FROM user_profiles WHERE username IN ({um})", names)
        c.execute(f"DELETE FROM users WHERE username IN ({um})", names)
        print(f"[cleanup] Removed {len(names)} demo users")
    print("[cleanup] Done.")


# ── Main ─────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--owner", default="Paulo", help="existing username to own the communities")
    ap.add_argument("--cleanup", action="store_true")
    ap.add_argument("--dry-run", action="store_true", help="validate datasets offline, print plan, write nothing")
    args = ap.parse_args()

    from werkzeug.security import generate_password_hash
    password_hash = generate_password_hash(DEMO_PASSWORD)

    plans = [build_language_plan(EN, "en", password_hash),
             build_language_plan(PT, "pt", password_hash)]
    problems = validate(plans)
    if problems:
        print("[seed] DATASET PROBLEMS:")
        for p in problems:
            print("  -", p)
        raise SystemExit(1)
    total_users = sum(len(p["users"]) for p in plans)
    print(f"[seed] Datasets OK: {total_users} demo users, 4 communities "
          f"({sum(len(p[k]['threads']) for p in plans for k in ('alumni', 'running'))} threads).")

    if args.dry_run:
        for plan in plans:
            for k in ("alumni", "running"):
                b = plan[k]
                n_posts = len(b["threads"])
                print(f"  {b['def']['name']}: {b['def']['members']} members, {n_posts} threads, "
                      f"{len(b['events'])} events, tier={b['def']['paid_tier'] or 'free'}")
                for sub in b["subs"]:
                    print(f"    - sub: {sub['def']['name']}: {sub['def']['members']} members, "
                          f"{len(sub['threads'])} threads")
        print("[seed] Dry-run complete. Nothing written.")
        return

    print(f"[seed] Connecting to {DEFAULT_USER}@{DEFAULT_HOST}:{DEFAULT_PORT}/{DEFAULT_DB}")
    conn = get_connection()
    try:
        c = conn.cursor()
        if args.cleanup:
            cleanup(c)
            return

        owner_username, owner_id = resolve_owner(c, args.owner)
        print(f"[seed] Owner: @{owner_username} (id={owner_id})")
        preflight_username_check(c, plans)
        print("[seed] Pre-flight username check passed — no collisions with real users")

        stats = {k: 0 for k in ("users", "posts", "replies", "reactions", "polls", "votes",
                                "events", "rsvps", "links", "visits", "invites", "members")}
        uid_by_username = {owner_username: owner_id}

        for plan in plans:
            for u in plan["users"]:
                uid_by_username[u["username"]] = insert_user(c, u)
                stats["users"] += 1
            print(f"[seed] [{plan['lang']}] {len(plan['users'])} users ready")

            for key in ("alumni", "running"):
                block = plan[key]
                cid = create_community(c, block["def"], owner_username, plan["lang"])
                add_membership(c, cid, owner_id, "owner", 60)
                curve = join_curve(len(block["members"]))
                # authors joined early so their old posts predate nothing
                for i, m in enumerate(block["members"]):
                    is_author = i < 15
                    jd = RNG.uniform(50, 59) if is_author else curve[i]
                    add_membership(c, cid, uid_by_username[m], "member", jd)
                    stats["members"] += 1
                everyone = [owner_username] + block["members"]
                if community_has_posts(c, cid):
                    print(f"[seed] [{plan['lang']}] '{block['def']['name']}' already has content — skipping feed/events/links/visits")
                else:
                    seed_threads(c, cid, block["threads"], uid_by_username, owner_username, everyone, stats)
                    seed_events(c, cid, block["events"], owner_username, everyone,
                                COMMUNITY_TZ[plan["lang"]], stats)
                    seed_links(c, cid, block["links"], owner_username, stats)
                    seed_visits(c, cid, everyone, stats)
                if not community_has_invites(c, cid):
                    seed_invites(c, cid, block["def"]["key"], owner_username, stats)
                print(f"[seed] [{plan['lang']}] '{block['def']['name']}' fully seeded")

                for sub in block["subs"]:
                    sub_cid = create_community(c, sub["def"], owner_username, plan["lang"],
                                               parent_id=cid)
                    add_membership(c, sub_cid, owner_id, "owner", 45)
                    sub_curve = join_curve(len(sub["members"]))
                    for i, m in enumerate(sub["members"]):
                        jd = RNG.uniform(35, 44) if i < len(sub["def"]["include_authors"]) else sub_curve[i]
                        add_membership(c, sub_cid, uid_by_username[m], "member", jd)
                        stats["members"] += 1
                    sub_everyone = [owner_username] + sub["members"]
                    if community_has_posts(c, sub_cid):
                        print(f"[seed] [{plan['lang']}]   sub '{sub['def']['name']}' already has content — skipping")
                    else:
                        seed_threads(c, sub_cid, sub["threads"], uid_by_username, owner_username,
                                     sub_everyone, stats)
                        seed_visits(c, sub_cid, sub_everyone, stats)
                    print(f"[seed] [{plan['lang']}]   sub-community '{sub['def']['name']}' seeded")

        print("\n" + "=" * 64)
        print("[seed] DONE.", json.dumps(stats))
        print(f"Owner of all 4 communities: @{owner_username}")
        print(f"Demo member password (all demo users): {DEMO_PASSWORD}")
        print("Cleanup: python scripts/seed_b2b_demo.py --cleanup")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
