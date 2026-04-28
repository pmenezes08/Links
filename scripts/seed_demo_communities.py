#!/usr/bin/env python3
"""Seed demo communities for investor showcase on **staging**.

Creates 5 communities owned by @JohnDoe with realistic members, posts,
polls, comments, reactions, and a calendar event for the travel community.

Communities:
    Summer Travelers   — 10 members (Free), holiday planning content + calendar event
    Future Thinkers    — 25 members (Free), investment/AI/space/education topics
    Growth Network     — 75 members (L1 tier)
    Scale Community    — 150 members (L2 tier)
    Enterprise Hub     — 250 members (L3 tier) + 3 sub-communities

All demo users have emails like ``staging_test_<name>@c-point.co`` for easy
identification and cleanup.

Run::

    # Via Cloud SQL proxy (recommended):
    cloud-sql-proxy --address 127.0.0.1 --port 3307 cpoint-127c2:europe-west1:<INSTANCE>
    python scripts/seed_demo_communities.py

    # Or with gcloud-auth flag:
    .\\cloud-sql-proxy.exe --gcloud-auth --address 127.0.0.1 --port 3307 "cpoint-127c2:europe-west1:cpoint-db"
    python scripts/seed_demo_communities.py

Cleanup::

    python scripts/seed_demo_communities.py --cleanup
"""

from __future__ import annotations

import argparse
import os
import random
import secrets
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

_REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _REPO)

# ── Configuration ───────────────────────────────────────────────────────

PROJECT = "cpoint-127c2"
DEFAULT_HOST = os.environ.get("MYSQL_HOST", "127.0.0.1")
DEFAULT_PORT = os.environ.get("MYSQL_PORT", "3307")
DEFAULT_USER = os.environ.get("MYSQL_USER", "app_user")
DEFAULT_DB = os.environ.get("MYSQL_DB", "cpoint")
PASSWORD_SECRET = "mysql-password"

DEMO_EMAIL_DOMAIN = "c-point.co"
DEMO_EMAIL_PREFIX = "staging_test_"
OWNER_USERNAME = "JohnDoe"
OWNER_EMAIL = f"{DEMO_EMAIL_PREFIX}john_doe@{DEMO_EMAIL_DOMAIN}"

# ── Realistic Names Pool (varied formats) ───────────────────────────────

# Full names (FirstLast format)
FULL_NAMES = [
    ("Sarah", "Mitchell"), ("Marco", "Costa"), ("Emma", "Wilson"), ("Carlos", "Garcia"),
    ("Aisha", "Patel"), ("Tom", "Hansen"), ("Yuki", "Tanaka"), ("Olivia", "Brown"),
    ("James", "Thompson"), ("Priya", "Sharma"), ("Lucas", "Silva"), ("Sofia", "Martinez"),
    ("Ahmed", "Khan"), ("Isabella", "Rossi"), ("Wei", "Chen"), ("Maria", "Lopez"),
    ("David", "Johnson"), ("Fatima", "Ali"), ("Michael", "Williams"), ("Zara", "Hassan"),
    ("Daniel", "Anderson"), ("Leila", "Nguyen"), ("Alex", "Taylor"), ("Nina", "Kim"),
    ("Ryan", "Moore"), ("Maya", "Singh"), ("Chris", "Jackson"), ("Amara", "Lee"),
    ("Kevin", "White"), ("Elena", "Park"), ("Jason", "Harris"), ("Layla", "Martin"),
    ("Brian", "Robinson"), ("Nadia", "Clark"), ("Eric", "Lewis"), ("Camila", "Walker"),
    ("Tyler", "Hall"), ("Jasmine", "Young"), ("Brandon", "King"), ("Rosa", "Wright"),
    ("Nathan", "Scott"), ("Aria", "Green"), ("Adam", "Baker"), ("Luna", "Adams"),
    ("Ethan", "Nelson"), ("Stella", "Hill"), ("Noah", "Campbell"), ("Aurora", "Mitchell"),
    ("Mason", "Roberts"), ("Lily", "Carter"), ("Logan", "Phillips"), ("Grace", "Evans"),
    ("Jacob", "Turner"), ("Chloe", "Collins"), ("Owen", "Edwards"), ("Mia", "Stewart"),
    ("Sebastian", "Morris"), ("Ava", "Murphy"), ("Liam", "Rivera"), ("Zoe", "Cooper"),
    ("Oliver", "Richardson"), ("Hannah", "Cox"), ("Elijah", "Howard"), ("Natalie", "Ward"),
    ("Leo", "Torres"), ("Victoria", "Peterson"), ("Julian", "Gray"), ("Samantha", "James"),
    ("Felix", "Watson"), ("Rachel", "Brooks"), ("Max", "Kelly"), ("Nicole", "Sanders"),
    ("Oscar", "Price"), ("Jessica", "Bennett"), ("Hugo", "Wood"), ("Amanda", "Barnes"),
    ("Arthur", "Ross"), ("Megan", "Henderson"), ("Theo", "Coleman"), ("Ashley", "Jenkins"),
    ("Finn", "Perry"), ("Lauren", "Powell"), ("Jack", "Long"), ("Rebecca", "Patterson"),
    ("Harry", "Hughes"), ("Catherine", "Flores"), ("George", "Washington"), ("Emily", "Butler"),
    ("Charlie", "Simmons"), ("Sophia", "Foster"), ("Edward", "Gonzales"), ("Alice", "Bryant"),
    ("Benjamin", "Alexander"), ("Eleanor", "Russell"), ("Theodore", "Griffin"), ("Audrey", "Hayes"),
    ("Rafael", "Diaz"), ("Carmen", "Myers"), ("Diego", "Ford"), ("Valentina", "Hamilton"),
    ("Antonio", "Graham"), ("Gabriela", "Sullivan"), ("Pablo", "Wallace"), ("Lucia", "West"),
    ("Fernando", "Cole"), ("Isabel", "Stone"), ("Roberto", "Meyer"), ("Andrea", "Wallace"),
    ("Kenji", "Yamamoto"), ("Sakura", "Suzuki"), ("Takeshi", "Sato"), ("Hana", "Watanabe"),
    ("Raj", "Gupta"), ("Ananya", "Reddy"), ("Arjun", "Kapoor"), ("Devi", "Iyer"),
    ("Omar", "Farouk"), ("Amina", "Said"), ("Khalid", "Rahman"), ("Sara", "Hussein"),
]

# Single-word usernames (nicknames, handles)
SINGLE_NAMES = [
    "Phoenix", "River", "Sage", "Quinn", "Blake", "Jordan", "Taylor", "Morgan",
    "Casey", "Riley", "Avery", "Parker", "Skyler", "Reese", "Finley", "Rowan",
    "Marley", "Hayden", "Emery", "Kendall", "Jessie", "Dakota", "Harley", "Remy",
    "Jules", "Drew", "Cameron", "Adrian", "Sam", "Jamie", "Robin", "Lee",
    "Kai", "Ash", "Nico", "Ezra", "Milo", "Arlo", "Zion", "Atlas",
    "Indie", "Storm", "Blaze", "Cruz", "Jett", "Knox", "Axel", "Zane",
    "Nova", "Luna", "Aria", "Ivy", "Willow", "Hazel", "Aurora", "Iris",
]

# ── Community Definitions ───────────────────────────────────────────────

COMMUNITIES = [
    {
        "name": "Summer Travelers",
        "members": 10,
        "tier": "free",
        "description": "Planning our epic summer adventure together! Join us as we decide on destinations, accommodation, and activities for the trip of a lifetime.",
    },
    {
        "name": "Future Thinkers",
        "members": 25,
        "tier": "free",
        "description": "A community of forward-looking minds exploring investment opportunities, space exploration, AI advancements, and the future of education. Big ideas welcome.",
    },
    {
        "name": "Growth Network",
        "members": 75,
        "tier": "paid_l1",
        "description": "For ambitious professionals focused on personal and career growth. Share insights, find mentors, and level up together.",
    },
    {
        "name": "Scale Community",
        "members": 150,
        "tier": "paid_l2",
        "description": "Connecting entrepreneurs and leaders who are actively scaling their ventures. Real talk about growth challenges and wins.",
    },
    {
        "name": "Enterprise Hub",
        "members": 250,
        "tier": "paid_l3",
        "description": "The premier community for enterprise leaders and decision makers. Strategic discussions, industry insights, and high-level networking.",
        "sub_communities": [
            {
                "name": "Tech Leadership",
                "members": 60,
                "description": "CTOs, VPs of Engineering, and tech leaders sharing insights on building and scaling engineering teams.",
            },
            {
                "name": "Product Strategy",
                "members": 45,
                "description": "Product leaders discussing roadmaps, user research, and go-to-market strategies.",
            },
            {
                "name": "Sales & Revenue",
                "members": 40,
                "description": "Sales leaders and revenue operators sharing playbooks and closing strategies.",
            },
        ],
    },
]

# ── Realistic Conversation Content ──────────────────────────────────────

SUMMER_TRAVELERS_CONVERSATION = [
    # Thread 1: Destination discussion
    {
        "post": {
            "author_offset": 0,
            "content": "Hey everyone! So excited we're finally doing this! I've been dreaming about a summer trip for ages. Where should we go? I'm thinking somewhere with great beaches AND good food. Open to ideas!",
            "days_ago": 14,
        },
        "replies": [
            {"author_offset": 1, "content": "Greece has been on my bucket list forever! The islands look absolutely stunning. Santorini, Mykonos... plus the food is incredible.", "days_ago": 14},
            {"author_offset": 2, "content": "@{1} I went to Greece last summer and honestly it's a bit touristy now. Have you considered Portugal? Way more affordable and the coastline in Algarve is gorgeous.", "days_ago": 14, "parent": 0},
            {"author_offset": 3, "content": "Portugal is amazing! Lisbon has such a cool vibe - the street art, the food, the nightlife. And then you can take a train down to the beach towns.", "days_ago": 13, "parent": 1},
            {"author_offset": 4, "content": "What about Croatia? Dubrovnik is like stepping into Game of Thrones. The water is crystal clear and it's not as crowded as you'd think.", "days_ago": 13},
            {"author_offset": 0, "content": "Loving all these ideas! Croatia does look incredible. @{4} when did you go? How was the weather?", "days_ago": 13, "parent": 3},
            {"author_offset": 4, "content": "@{0} I went in late June - perfect weather, around 28-30°C. Not too hot, great for swimming. The locals are super friendly too.", "days_ago": 13, "parent": 4},
        ],
    },
    # Thread 2: Poll about destination
    {
        "poll": {
            "author_offset": 0,
            "question": "Alright team, let's vote! Where are we heading this summer?",
            "options": ["Greece - Island hopping adventure", "Portugal - Lisbon + Algarve beaches", "Croatia - Dubrovnik & coastal towns", "Thailand - Beaches, temples & street food"],
            "days_ago": 12,
        },
    },
    # Thread 3: Accommodation discussion
    {
        "post": {
            "author_offset": 5,
            "content": "While we decide on the destination, let's talk accommodation! What's everyone's budget and preference? I've found some amazing Airbnbs that could fit all of us.",
            "days_ago": 11,
        },
        "replies": [
            {"author_offset": 6, "content": "I'd love a villa with a pool if we can swing it! Nothing beats morning swims before heading out.", "days_ago": 11},
            {"author_offset": 7, "content": "Villa sounds great but could be pricey. What if we do 2-3 nights hotel at the start then villa for the rest? Best of both worlds.", "days_ago": 11, "parent": 0},
            {"author_offset": 5, "content": "@{7} Smart thinking! That way we can explore the city first without worrying about parking or location.", "days_ago": 10, "parent": 1},
            {"author_offset": 8, "content": "Found a place in Algarve - 5 bedroom villa, private pool, rooftop terrace with ocean views. €120/night split between us is nothing!", "days_ago": 10},
            {"author_offset": 9, "content": "That sounds AMAZING @{8}! Can you share the link? My only ask is good wifi - I might need to hop on a couple calls.", "days_ago": 10, "parent": 3},
        ],
    },
    # Thread 4: Activities poll
    {
        "poll": {
            "author_offset": 0,
            "question": "What activities are must-dos for everyone? Pick your top priorities!",
            "options": ["Beach days & water sports", "Hiking & nature trails", "City tours & cultural sites", "Food tours & wine tasting"],
            "days_ago": 9,
        },
    },
    # Thread 5: Finalizing plans
    {
        "post": {
            "author_offset": 0,
            "content": "Okay team, based on all the votes and discussion, here's what I'm thinking:\n\n📍 **Destination:** Portugal (Algarve region)\n📅 **Dates:** July 15-25, 2026\n🏠 **Stay:** Villa in Lagos area\n💰 **Budget:** ~$1,500-2,000 per person all-in\n\nSound good to everyone? If we're all in, I'll create the calendar event and we can start booking!",
            "days_ago": 5,
        },
        "replies": [
            {"author_offset": 3, "content": "COUNT ME IN! This is going to be legendary. Already looking at flights 🛫", "days_ago": 5},
            {"author_offset": 6, "content": "Yes! I've been dying to try Portuguese wine. Let's do this!", "days_ago": 5},
            {"author_offset": 8, "content": "Booking confirmed for the villa! Just sent everyone the details. €960 total for 10 nights 🏡", "days_ago": 4},
            {"author_offset": 1, "content": "Just booked my flight! Landing in Faro at 2pm on the 15th. Anyone else on that flight?", "days_ago": 4},
            {"author_offset": 2, "content": "@{1} I'm on a later flight but will arrive same day. Can't wait to see everyone!", "days_ago": 4, "parent": 3},
            {"author_offset": 0, "content": "This is happening! Created the calendar event with all the details. See everyone in Portugal! 🇵🇹", "days_ago": 3},
        ],
    },
]

FUTURE_THINKERS_CONVERSATIONS = {
    "investment": [
        {
            "post": {
                "author_offset": 0,
                "content": "Been thinking a lot about the AI investment landscape. There's so much hype, but where do you see the real opportunities? I'm looking beyond the obvious plays like NVIDIA.",
                "days_ago": 21,
            },
            "replies": [
                {"author_offset": 3, "content": "I've been looking at AI infrastructure companies - not the model makers, but the picks and shovels. Data centers, cooling systems, power management.", "days_ago": 21},
                {"author_offset": 7, "content": "@{3} That's smart. Also worth looking at vertical AI applications - companies applying AI to specific industries rather than building general-purpose models.", "days_ago": 20, "parent": 0},
                {"author_offset": 12, "content": "Don't sleep on AI safety and governance companies. As regulation increases, these will become essential.", "days_ago": 20},
                {"author_offset": 0, "content": "Great points all around. I've also been watching the AI + healthcare space. The regulatory moat there is massive.", "days_ago": 20, "parent": 2},
            ],
        },
        {
            "post": {
                "author_offset": 5,
                "content": "Climate tech is having a moment. New regulations in EU and US are creating massive tailwinds. Anyone else tracking this sector?",
                "days_ago": 18,
            },
            "replies": [
                {"author_offset": 9, "content": "Yes! Carbon capture is interesting but the unit economics are still tough. I'm more bullish on grid modernization - it's a must-have.", "days_ago": 18},
                {"author_offset": 14, "content": "Battery technology is where the real breakthroughs are happening. Solid-state batteries could be a game changer for EVs and grid storage.", "days_ago": 17, "parent": 0},
                {"author_offset": 5, "content": "@{14} Agreed. QuantumScape and Solid Power are the ones I'm watching. Long timelines but massive upside.", "days_ago": 17, "parent": 1},
            ],
        },
    ],
    "space": [
        {
            "post": {
                "author_offset": 2,
                "content": "SpaceX's latest Starship test was mind-blowing. We're genuinely getting closer to Mars. What's your realistic timeline for human settlement? I'm thinking 2045.",
                "days_ago": 20,
            },
            "replies": [
                {"author_offset": 8, "content": "2045 for a permanent base seems optimistic but not impossible. The bigger question is: why Mars when we could build O'Neill cylinders?", "days_ago": 20},
                {"author_offset": 11, "content": "@{8} Surface of a planet gives you resources - water ice, minerals, atmosphere for ISRU. Cylinders need everything shipped.", "days_ago": 20, "parent": 0},
                {"author_offset": 2, "content": "Good debate! I think we'll see both. Moon base by 2030, Mars visits by 2035, permanent presence by 2045-2050.", "days_ago": 19, "parent": 1},
                {"author_offset": 16, "content": "The economics only work if Starship brings launch costs down 100x. That's the linchpin for everything.", "days_ago": 19},
            ],
        },
        {
            "post": {
                "author_offset": 6,
                "content": "Space tourism is becoming real. Blue Origin and SpaceX are taking bookings. Would you pay $250k for 10 minutes in space? Honest answers only.",
                "days_ago": 15,
            },
            "replies": [
                {"author_offset": 10, "content": "Honestly? Yes. It's a once-in-a-lifetime experience. That said, I'd probably wait until prices drop to $50k range.", "days_ago": 15},
                {"author_offset": 19, "content": "Hard no from me. $250k is a house deposit. I'll wait until it's $10k and a week-long trip to a space hotel.", "days_ago": 15},
                {"author_offset": 6, "content": "@{19} Fair! Though housing prices might mean space is the better investment by then 😂", "days_ago": 14, "parent": 1},
            ],
        },
    ],
    "ai": [
        {
            "post": {
                "author_offset": 4,
                "content": "The pace of AI development is staggering. GPT-5, Claude, Gemini - they're writing code, creating art, passing bar exams. Where does this end? Are we 5 years from AGI or 50?",
                "days_ago": 19,
            },
            "replies": [
                {"author_offset": 1, "content": "I think AGI is a moving goalpost. Every time AI achieves something, we redefine what 'intelligence' means. More useful to focus on capabilities.", "days_ago": 19},
                {"author_offset": 13, "content": "@{1} Fair point. The more interesting question might be: at what capability level does AI fundamentally change society? We might already be there.", "days_ago": 18, "parent": 0},
                {"author_offset": 4, "content": "I've integrated AI into my daily work and it's doubled my productivity. But I also see colleagues who refuse to adapt. The gap is widening.", "days_ago": 18},
                {"author_offset": 20, "content": "The job displacement concerns are real. But historically, technology creates more jobs than it destroys. The transition is just painful.", "days_ago": 18, "parent": 2},
            ],
        },
        {
            "post": {
                "author_offset": 15,
                "content": "AI in healthcare might be the most impactful application. Diagnostic tools spotting cancer earlier than human doctors. Drug discovery accelerated by 10x. This will save millions of lives.",
                "days_ago": 14,
            },
            "replies": [
                {"author_offset": 22, "content": "The FDA approval process is the bottleneck. AI can discover drugs in months, but trials still take years. We need regulatory innovation too.", "days_ago": 14},
                {"author_offset": 15, "content": "@{22} True, but FDA is actually adapting faster than expected. They've approved several AI diagnostic tools already.", "days_ago": 13, "parent": 0},
                {"author_offset": 7, "content": "The real revolution will be personalized medicine. AI analyzing your genetics + lifestyle + environment to tailor treatments specifically to you.", "days_ago": 13},
            ],
        },
    ],
    "education": [
        {
            "post": {
                "author_offset": 17,
                "content": "Traditional education is being disrupted like never before. Online courses, AI tutors, micro-credentials... Are universities becoming obsolete? Hot take: in 20 years, elite degrees won't matter.",
                "days_ago": 17,
            },
            "replies": [
                {"author_offset": 21, "content": "Universities still offer something online can't: network effects. The value is in the alumni network and signaling, not the learning.", "days_ago": 17},
                {"author_offset": 24, "content": "@{21} But networks are moving online too. Discord communities, Twitter/X, cohort-based courses - these are the new networks.", "days_ago": 16, "parent": 0},
                {"author_offset": 17, "content": "Exactly @{24}. I learned more from online communities in 2 years than 4 years of college. The democratization of knowledge is incredible.", "days_ago": 16, "parent": 1},
                {"author_offset": 18, "content": "The skills gap is the real problem. Schools teach 20th century skills for 21st century jobs. We need to completely reimagine curriculum.", "days_ago": 16},
            ],
        },
        {
            "post": {
                "author_offset": 23,
                "content": "Imagine AI tutors that adapt to each student's learning style, pace, and interests. Every kid gets a personalized education. This could be the great equalizer - quality education regardless of zip code.",
                "days_ago": 12,
            },
            "replies": [
                {"author_offset": 0, "content": "Khan Academy is already doing this to some extent. The results are promising but we need more longitudinal studies.", "days_ago": 12},
                {"author_offset": 11, "content": "The key is making it engaging. AI can personalize, but keeping kids motivated is the hard part. Gamification might be the answer.", "days_ago": 11, "parent": 0},
                {"author_offset": 23, "content": "@{11} Duolingo has cracked this for languages. Same principles could apply to math, science, history...", "days_ago": 11, "parent": 1},
            ],
        },
    ],
}

ENTERPRISE_HUB_CONVERSATIONS = [
    {
        "post": {
            "author_offset": 0,
            "content": "Welcome to Enterprise Hub! This is our space for strategic discussions, industry insights, and high-level networking. Looking forward to learning from this incredible group of leaders.",
            "days_ago": 30,
        },
        "replies": [
            {"author_offset": 5, "content": "Excited to be here! Great to connect with fellow enterprise leaders. Anyone else navigating the AI transformation at scale?", "days_ago": 30},
            {"author_offset": 12, "content": "@{5} We're right in the middle of it. Happy to share what's working (and what isn't) for us.", "days_ago": 29, "parent": 0},
        ],
    },
    {
        "post": {
            "author_offset": 8,
            "content": "Question for the group: How are you approaching enterprise AI adoption? Top-down mandates vs bottom-up experimentation? We've tried both with mixed results.",
            "days_ago": 25,
        },
        "replies": [
            {"author_offset": 15, "content": "Hybrid approach worked best for us. Executive sponsorship for strategic initiatives, but sandbox environments for teams to experiment.", "days_ago": 25},
            {"author_offset": 22, "content": "@{15} How do you handle the governance piece? Our legal/compliance teams are blocking everything.", "days_ago": 24, "parent": 0},
            {"author_offset": 15, "content": "@{22} We brought them in early. Created an AI council with legal, security, and business leaders. They feel ownership now vs being gatekeepers.", "days_ago": 24, "parent": 1},
            {"author_offset": 8, "content": "Love the AI council idea. We might steal that. How often does it meet?", "days_ago": 24, "parent": 2},
        ],
    },
    {
        "post": {
            "author_offset": 30,
            "content": "The talent war is real. How are you retaining your best people in this market? We've had 3 senior leaders poached in Q1 alone.",
            "days_ago": 20,
        },
        "replies": [
            {"author_offset": 45, "content": "Money isn't enough anymore. Our top retention tools: meaningful work, autonomy, and genuine growth paths. Plus flexible work arrangements.", "days_ago": 20},
            {"author_offset": 60, "content": "We've started internal mobility programs. Easier to move between teams/roles. People stay because they can reinvent themselves here.", "days_ago": 19, "parent": 0},
            {"author_offset": 30, "content": "Internal mobility is interesting. How do managers react when their people move? That's always been our friction point.", "days_ago": 19, "parent": 1},
            {"author_offset": 60, "content": "@{30} Changed the incentives. Managers are now measured on talent developed and exported, not just retained.", "days_ago": 19, "parent": 2},
        ],
    },
]

TECH_LEADERSHIP_CONVERSATIONS = [
    {
        "post": {
            "author_offset": 0,
            "content": "Platform engineering is eating DevOps. We're seeing 40% productivity gains from internal developer platforms. Anyone else on this journey?",
            "days_ago": 15,
        },
        "replies": [
            {"author_offset": 8, "content": "We built our IDP on Backstage. Game changer for developer experience. Onboarding time went from 2 weeks to 2 days.", "days_ago": 15},
            {"author_offset": 15, "content": "@{8} How did you handle the golden paths vs flexibility tradeoff? Our devs want customization.", "days_ago": 14, "parent": 0},
            {"author_offset": 8, "content": "@{15} 80/20 rule. Golden paths for 80% of use cases, escape hatches for the rest. Document both heavily.", "days_ago": 14, "parent": 1},
        ],
    },
    {
        "post": {
            "author_offset": 12,
            "content": "Engineering leadership question: How do you balance technical debt paydown vs feature delivery? My backlog of tech debt is growing and I'm getting pressure from product.",
            "days_ago": 10,
        },
        "replies": [
            {"author_offset": 3, "content": "We allocate 20% of every sprint to tech debt. Non-negotiable. Frame it as 'maintaining velocity' not 'slowing down'.", "days_ago": 10},
            {"author_offset": 20, "content": "Quantify the cost of tech debt in developer hours. When product sees 'feature X takes 3 weeks instead of 1 because of tech debt', they get it.", "days_ago": 10, "parent": 0},
            {"author_offset": 12, "content": "@{20} That's brilliant. I've been hand-waving about 'code quality'. Putting hours on it makes it tangible.", "days_ago": 9, "parent": 1},
        ],
    },
]

PRODUCT_STRATEGY_CONVERSATIONS = [
    {
        "post": {
            "author_offset": 0,
            "content": "PLG vs SLG vs hybrid - what's working for enterprise products in 2026? We're seeing bottoms-up adoption but struggling to convert to enterprise contracts.",
            "days_ago": 12,
        },
        "replies": [
            {"author_offset": 5, "content": "The conversion problem is usually pricing/packaging. Do you have clear upgrade triggers? Usage limits that naturally push to sales conversations?",  "days_ago": 12},
            {"author_offset": 10, "content": "We added 'workspace analytics' for admins. Once IT sees the shadow usage, they want central procurement. Works like a charm.", "days_ago": 11, "parent": 0},
            {"author_offset": 0, "content": "@{10} Clever! Making the existing usage visible to budget holders. We should try that.", "days_ago": 11, "parent": 1},
        ],
    },
    {
        "post": {
            "author_offset": 15,
            "content": "AI feature prioritization is tough. Every stakeholder wants 'their AI feature'. How are you deciding what to build vs buy vs partner on?",
            "days_ago": 8,
        },
        "replies": [
            {"author_offset": 22, "content": "Framework we use: Is AI core to your differentiation? Build. Is it table stakes? Buy/integrate. Is it experimental? Partner.", "days_ago": 8},
            {"author_offset": 30, "content": "Also consider data moats. If the AI feature uses proprietary data that improves over time, you probably want to own it.", "days_ago": 8, "parent": 0},
            {"author_offset": 15, "content": "Great frameworks. @{30} the data moat point is key. That's our competitive advantage.", "days_ago": 7, "parent": 1},
        ],
    },
]

SALES_REVENUE_CONVERSATIONS = [
    {
        "post": {
            "author_offset": 0,
            "content": "AI is transforming sales. We're using AI for call analysis, email personalization, and forecasting. Our win rates are up 15%. What tools are working for you?",
            "days_ago": 14,
        },
        "replies": [
            {"author_offset": 8, "content": "Gong + Clay + ChatGPT combo is powerful. Gong for insights, Clay for enrichment, ChatGPT for email drafting. Reps save 10+ hours/week.", "days_ago": 14},
            {"author_offset": 12, "content": "@{8} How do you handle personalization at scale? Generic AI emails get ignored.", "days_ago": 13, "parent": 0},
            {"author_offset": 8, "content": "@{12} We built prompt templates with required personalization fields. Can't send without adding company-specific context.", "days_ago": 13, "parent": 1},
        ],
    },
    {
        "post": {
            "author_offset": 18,
            "content": "Controversial take: The SDR/AE split is outdated. Full-cycle reps outperform the pipeline handoff model. Anyone else seeing this?",
            "days_ago": 10,
        },
        "replies": [
            {"author_offset": 5, "content": "Depends on ACV. Sub-$50k deals? Full cycle makes sense. Enterprise six-figure deals? Specialization still wins.", "days_ago": 10},
            {"author_offset": 25, "content": "We went full-cycle last year. NRR improved but overall volume dropped. Now we're hybrid - SDRs for outbound, AEs do inbound end-to-end.", "days_ago": 9, "parent": 0},
            {"author_offset": 18, "content": "@{25} Interesting hybrid. What's your split inbound vs outbound?", "days_ago": 9, "parent": 1},
        ],
    },
]

GROWTH_NETWORK_CONVERSATIONS = [
    {
        "post": {
            "author_offset": 0,
            "content": "Welcome to Growth Network! This is the place for ambitious professionals who want to level up their careers. Share insights, find mentors, and grow together. Introduce yourself below!",
            "days_ago": 30,
        },
        "replies": [
            {"author_offset": 5, "content": "Hey everyone! Product manager at a Series B startup. Here to connect with other PMs and learn from different industries.", "days_ago": 30},
            {"author_offset": 12, "content": "Marketing lead transitioning into growth. Excited to learn from people who've made similar moves!", "days_ago": 29, "parent": 0},
            {"author_offset": 20, "content": "Engineering manager working on my leadership skills. Looking forward to the discussions here.", "days_ago": 29},
        ],
    },
    {
        "post": {
            "author_offset": 8,
            "content": "Best career advice you've received? I'll start: 'Your network is your net worth' - sounds cliché but it's proven true every time I've changed jobs.",
            "days_ago": 20,
        },
        "replies": [
            {"author_offset": 15, "content": "'Always be learning.' The moment you stop growing, you start becoming obsolete.", "days_ago": 20},
            {"author_offset": 30, "content": "'Take the meeting.' You never know where an unexpected conversation might lead.", "days_ago": 19, "parent": 0},
            {"author_offset": 8, "content": "@{30} Love that one. Some of my best opportunities came from 'random' coffees.", "days_ago": 19, "parent": 1},
        ],
    },
]

SCALE_COMMUNITY_CONVERSATIONS = [
    {
        "post": {
            "author_offset": 0,
            "content": "Welcome to Scale Community! If you're actively scaling a venture - whether that's from 10 to 100 people or $1M to $10M ARR - you're in the right place. Real talk about the messy middle of growth.",
            "days_ago": 28,
        },
        "replies": [
            {"author_offset": 10, "content": "Just crossed 50 employees. The growing pains are real. Excited to learn from people who've been there.", "days_ago": 28},
            {"author_offset": 25, "content": "Scaling from $2M to $8M ARR this year. The playbooks that got us here won't get us there. Need new perspectives.", "days_ago": 27, "parent": 0},
        ],
    },
    {
        "post": {
            "author_offset": 15,
            "content": "What broke first when you scaled past 50 people? For us it was communication. We went from 'everyone knows everything' to silos overnight.",
            "days_ago": 18,
        },
        "replies": [
            {"author_offset": 40, "content": "Hiring. We went from 'hire people we know' to 'hire strangers' and our bar dropped before we fixed it.", "days_ago": 18},
            {"author_offset": 60, "content": "Culture documentation. What was implicit became confusing. We had to write down 'how we work here' for new people.", "days_ago": 17, "parent": 0},
            {"author_offset": 15, "content": "@{60} Did you do a formal culture doc or something more organic like an employee handbook?", "days_ago": 17, "parent": 1},
        ],
    },
]

# ── Calendar Event ──────────────────────────────────────────────────────

CALENDAR_EVENT = {
    "title": "Summer Trip 2026 - Portugal Adventure",
    "date": "2026-07-15",
    "end_date": "2026-07-25",
    "time": "10:00",
    "start_time": "2026-07-15 10:00:00",
    "end_time": "2026-07-25 22:00:00",
    "description": "Our epic summer trip to Portugal! 10 days exploring the beautiful Algarve region.\n\nItinerary:\n- Jul 15: Arrival in Faro, transfer to Lagos villa\n- Jul 16-17: Beach days & water sports\n- Jul 18: Day trip to Sagres & Cape St. Vincent\n- Jul 19: Wine tasting in Alentejo\n- Jul 20-21: Lisbon city exploration\n- Jul 22: Sintra palaces day trip\n- Jul 23-24: Back to Algarve, final beach days\n- Jul 25: Departure\n\nBring: Sunscreen, comfortable shoes, appetite for seafood!",
    "location": "Algarve, Portugal",
    "timezone": "Europe/Lisbon",
}

# ── Secret Manager helper ───────────────────────────────────────────────


def fetch_password_from_secrets() -> str:
    if os.environ.get("MYSQL_PASSWORD"):
        print("[seed] Using MYSQL_PASSWORD from env (override)", file=sys.stderr)
        return os.environ["MYSQL_PASSWORD"]

    cmd = [
        "gcloud", "secrets", "versions", "access", "latest",
        f"--secret={PASSWORD_SECRET}",
        f"--project={PROJECT}",
    ]
    try:
        pw = subprocess.check_output(cmd, text=True, stderr=subprocess.PIPE).strip()
    except FileNotFoundError:
        raise SystemExit(
            "gcloud CLI not found. Install Google Cloud SDK and run `gcloud auth login`."
        )
    except subprocess.CalledProcessError as err:
        raise SystemExit(
            f"Failed to read secret '{PASSWORD_SECRET}' from project {PROJECT}:\n"
            f"{err.stderr}\n"
        )
    if not pw:
        raise SystemExit(f"Secret '{PASSWORD_SECRET}' returned empty value.")
    return pw


# ── DB helpers ──────────────────────────────────────────────────────────


def get_connection():
    try:
        import pymysql
        from pymysql.cursors import DictCursor
    except ImportError:
        raise SystemExit("PyMySQL is required. pip install pymysql")

    return pymysql.connect(
        host=DEFAULT_HOST,
        port=int(DEFAULT_PORT),
        user=DEFAULT_USER,
        password=fetch_password_from_secrets(),
        database=DEFAULT_DB,
        charset="utf8mb4",
        autocommit=True,
        cursorclass=DictCursor,
        connect_timeout=10,
    )


def _now_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _days_ago(n: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=n)).strftime("%Y-%m-%d %H:%M:%S")


def _generate_join_code() -> str:
    return secrets.token_urlsafe(8)[:12].upper()


# ── User Generation ─────────────────────────────────────────────────────


def generate_users(count: int, exclude_names: set) -> List[Dict[str, str]]:
    """Generate unique user profiles with varied name formats."""
    from werkzeug.security import generate_password_hash

    users = []
    used_usernames = set(u.lower() for u in exclude_names)
    password_hash = generate_password_hash("DemoPass123!")

    # Mix full names and single names (70% full, 30% single)
    full_name_count = int(count * 0.7)
    single_name_count = count - full_name_count

    # Add full names with interleaved pattern
    random.seed(42)  # Deterministic but varied
    shuffled_full = list(FULL_NAMES)
    random.shuffle(shuffled_full)

    for first, last in shuffled_full:
        if len(users) >= full_name_count:
            break
        username = f"{first}{last}"
        if username.lower() in used_usernames:
            continue
        used_usernames.add(username.lower())
        email_slug = f"{first.lower()}_{last.lower()}"
        users.append({
            "username": username,
            "email": f"{DEMO_EMAIL_PREFIX}{email_slug}@{DEMO_EMAIL_DOMAIN}",
            "first_name": first,
            "last_name": last,
            "display_name": f"{first} {last}",
            "password": password_hash,
        })

    # Add single-word usernames
    shuffled_single = list(SINGLE_NAMES)
    random.shuffle(shuffled_single)

    for name in shuffled_single:
        if len(users) >= count:
            break
        if name.lower() in used_usernames:
            continue
        used_usernames.add(name.lower())
        email_slug = name.lower()
        users.append({
            "username": name,
            "email": f"{DEMO_EMAIL_PREFIX}{email_slug}@{DEMO_EMAIL_DOMAIN}",
            "first_name": name,
            "last_name": "",
            "display_name": name,
            "password": password_hash,
        })

    # If still need more, generate with numbers
    counter = 1
    while len(users) < count:
        for first, last in FULL_NAMES:
            if len(users) >= count:
                break
            username = f"{first}{last}{counter}"
            if username.lower() in used_usernames:
                continue
            used_usernames.add(username.lower())
            email_slug = f"{first.lower()}_{last.lower()}_{counter}"
            users.append({
                "username": username,
                "email": f"{DEMO_EMAIL_PREFIX}{email_slug}@{DEMO_EMAIL_DOMAIN}",
                "first_name": first,
                "last_name": last,
                "display_name": f"{first} {last}",
                "password": password_hash,
            })
        counter += 1

    return users[:count]


# ── Seeding Functions ───────────────────────────────────────────────────


def ensure_owner(cursor) -> int:
    """Ensure JohnDoe exists and return user ID."""
    from werkzeug.security import generate_password_hash

    cursor.execute("SELECT id FROM users WHERE username = %s", (OWNER_USERNAME,))
    row = cursor.fetchone()
    if row:
        print(f"[seed] Owner @{OWNER_USERNAME} exists (id={row['id']})")
        return int(row["id"])

    cursor.execute(
        """
        INSERT INTO users (username, email, password, first_name, last_name,
                           subscription, is_active, email_verified, created_at)
        VALUES (%s, %s, %s, %s, %s, 'free', 1, 1, %s)
        """,
        (
            OWNER_USERNAME,
            OWNER_EMAIL,
            generate_password_hash("DemoOwner123!"),
            "John",
            "Doe",
            _days_ago(90),
        ),
    )
    owner_id = cursor.lastrowid

    cursor.execute(
        """
        INSERT IGNORE INTO user_profiles (username, display_name, bio, created_at)
        VALUES (%s, %s, %s, %s)
        """,
        (OWNER_USERNAME, "John Doe", "Community builder and adventure seeker.", _now_str()),
    )

    print(f"[seed] Created owner @{OWNER_USERNAME} (id={owner_id})")
    return int(owner_id)


def create_users(cursor, users: List[Dict[str, str]]) -> Dict[str, int]:
    """Insert users and return username -> id mapping."""
    username_to_id = {}
    created = 0
    skipped = 0

    for u in users:
        cursor.execute("SELECT id FROM users WHERE username = %s", (u["username"],))
        row = cursor.fetchone()
        if row:
            username_to_id[u["username"]] = int(row["id"])
            skipped += 1
            continue

        cursor.execute(
            """
            INSERT INTO users (username, email, password, first_name, last_name,
                               subscription, is_active, email_verified, created_at)
            VALUES (%s, %s, %s, %s, %s, 'free', 1, 1, %s)
            """,
            (
                u["username"],
                u["email"],
                u["password"],
                u["first_name"],
                u["last_name"],
                _days_ago(random.randint(30, 180)),
            ),
        )
        user_id = cursor.lastrowid
        username_to_id[u["username"]] = int(user_id)

        cursor.execute(
            """
            INSERT IGNORE INTO user_profiles (username, display_name, created_at)
            VALUES (%s, %s, %s)
            """,
            (u["username"], u["display_name"], _now_str()),
        )
        created += 1

    print(f"[seed] Users: {created} created, {skipped} already existed")
    return username_to_id


def create_community(cursor, community: Dict[str, Any], owner_username: str, parent_id: Optional[int] = None) -> int:
    """Create a community and return its ID."""
    cursor.execute("SELECT id FROM communities WHERE name = %s", (community["name"],))
    row = cursor.fetchone()
    if row:
        cid = int(row["id"])
        tier = community.get("tier", "free")
        cursor.execute(
            "UPDATE communities SET tier = %s, description = %s WHERE id = %s",
            (tier, community.get("description", ""), cid),
        )
        print(f"[seed] Community '{community['name']}' exists (id={cid}), updated")
        return cid

    tier = community.get("tier", "free")
    cursor.execute(
        """
        INSERT INTO communities (name, type, creator_username, join_code, tier, description,
                                 is_active, created_at, parent_community_id)
        VALUES (%s, %s, %s, %s, %s, %s, 1, %s, %s)
        """,
        (
            community["name"],
            "community",
            owner_username,
            _generate_join_code(),
            tier,
            community.get("description", ""),
            _days_ago(60),
            parent_id,
        ),
    )
    cid = int(cursor.lastrowid)
    print(f"[seed] Created community '{community['name']}' (id={cid}, tier={tier}, parent={parent_id})")
    return cid


def add_member(cursor, community_id: int, user_id: int, role: str = "member") -> bool:
    """Add a single member to a community. Returns True if added."""
    cursor.execute(
        """
        INSERT IGNORE INTO user_communities (user_id, community_id, role, joined_at)
        VALUES (%s, %s, %s, %s)
        """,
        (user_id, community_id, role, _days_ago(random.randint(1, 45))),
    )
    return cursor.rowcount > 0


def add_members(cursor, community_id: int, user_ids: List[int], owner_id: int) -> int:
    """Add members to a community including the owner. Returns count of new memberships."""
    added = 0

    # Add owner first with 'owner' role
    if add_member(cursor, community_id, owner_id, role="owner"):
        added += 1

    # Add other members
    for user_id in user_ids:
        if user_id == owner_id:
            continue
        if add_member(cursor, community_id, user_id, role="member"):
            added += 1

    return added


def create_post(cursor, community_id: int, username: str, content: str, days_ago: int) -> int:
    """Create a post and return its ID."""
    cursor.execute(
        """
        INSERT INTO posts (username, content, community_id, timestamp)
        VALUES (%s, %s, %s, %s)
        """,
        (username, content, community_id, _days_ago(days_ago)),
    )
    return int(cursor.lastrowid)


def create_poll(
    cursor,
    community_id: int,
    post_id: int,
    username: str,
    question: str,
    options: List[str],
    days_ago: int,
) -> int:
    """Create a poll attached to a post and return poll ID."""
    cursor.execute(
        """
        INSERT INTO polls (post_id, question, created_by, is_active, single_vote, created_at)
        VALUES (%s, %s, %s, 1, 0, %s)
        """,
        (post_id, question, username, _days_ago(days_ago)),
    )
    poll_id = int(cursor.lastrowid)

    for opt_text in options:
        cursor.execute(
            """
            INSERT INTO poll_options (poll_id, option_text, votes)
            VALUES (%s, %s, 0)
            """,
            (poll_id, opt_text),
        )

    return poll_id


def vote_on_poll(cursor, poll_id: int, usernames: List[str]) -> None:
    """Distribute votes across poll options."""
    cursor.execute("SELECT id FROM poll_options WHERE poll_id = %s", (poll_id,))
    options = [row["id"] for row in cursor.fetchall()]
    if not options:
        return

    for username in usernames:
        option_id = random.choice(options)
        cursor.execute(
            """
            INSERT IGNORE INTO poll_votes (poll_id, option_id, username, voted_at)
            VALUES (%s, %s, %s, %s)
            """,
            (poll_id, option_id, username, _now_str()),
        )
        if cursor.rowcount > 0:
            cursor.execute(
                "UPDATE poll_options SET votes = votes + 1 WHERE id = %s",
                (option_id,),
            )


def create_reply(cursor, post_id: int, community_id: int, username: str, content: str,
                 days_ago: int, parent_reply_id: Optional[int] = None) -> int:
    """Create a reply/comment on a post, optionally nested."""
    cursor.execute(
        """
        INSERT INTO replies (post_id, community_id, username, content, timestamp, parent_reply_id)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (post_id, community_id, username, content, _days_ago(days_ago), parent_reply_id),
    )
    return int(cursor.lastrowid)


def add_reaction(cursor, post_id: int, username: str, reaction_type: str = "like") -> None:
    """Add a reaction to a post."""
    cursor.execute(
        """
        INSERT IGNORE INTO reactions (post_id, username, reaction_type)
        VALUES (%s, %s, %s)
        """,
        (post_id, username, reaction_type),
    )


def create_calendar_event(cursor, community_id: int, username: str, event: Dict[str, str]) -> int:
    """Create a calendar event."""
    cursor.execute(
        """
        INSERT INTO calendar_events (username, title, date, end_date, time, start_time, end_time,
                                     description, location, community_id, timezone,
                                     notification_preferences, created_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'all', %s)
        """,
        (
            username,
            event["title"],
            event["date"],
            event["end_date"],
            event["time"],
            event["start_time"],
            event["end_time"],
            event["description"],
            event["location"],
            community_id,
            event["timezone"],
            _now_str(),
        ),
    )
    return int(cursor.lastrowid)


# ── Content Seeding ─────────────────────────────────────────────────────


def seed_conversation(cursor, community_id: int, member_usernames: List[str], conversation: Dict) -> Dict[str, int]:
    """Seed a single conversation thread (post + replies or poll)."""
    stats = {"posts": 0, "polls": 0, "replies": 0}

    if "poll" in conversation:
        poll_data = conversation["poll"]
        author_idx = poll_data.get("author_offset", 0) % len(member_usernames)
        author = member_usernames[author_idx]

        post_id = create_post(cursor, community_id, author, f"📊 {poll_data['question']}", poll_data["days_ago"])
        stats["posts"] += 1

        poll_id = create_poll(cursor, community_id, post_id, author, poll_data["question"],
                              poll_data["options"], poll_data["days_ago"])
        stats["polls"] += 1

        # Everyone votes
        vote_on_poll(cursor, poll_id, member_usernames)

        # Add reactions
        for reactor in random.sample(member_usernames, min(len(member_usernames), 5)):
            add_reaction(cursor, post_id, reactor)

        return stats

    if "post" in conversation:
        post_data = conversation["post"]
        author_idx = post_data.get("author_offset", 0) % len(member_usernames)
        author = member_usernames[author_idx]

        post_id = create_post(cursor, community_id, author, post_data["content"], post_data["days_ago"])
        stats["posts"] += 1

        # Add reactions from various members
        num_reactions = random.randint(3, min(len(member_usernames), 12))
        reaction_types = ["like", "love", "insightful", "celebrate"]
        for reactor in random.sample(member_usernames, num_reactions):
            add_reaction(cursor, post_id, reactor, random.choice(reaction_types))

        # Add replies
        reply_id_map = {}  # Track reply IDs for nesting
        for i, reply_data in enumerate(conversation.get("replies", [])):
            reply_author_idx = reply_data.get("author_offset", 0) % len(member_usernames)
            reply_author = member_usernames[reply_author_idx]

            # Replace @{n} mentions with actual usernames
            content = reply_data["content"]
            for j in range(len(member_usernames)):
                content = content.replace(f"@{{{j}}}", f"@{member_usernames[j]}")

            # Handle nested replies
            parent_reply_id = None
            if "parent" in reply_data:
                parent_idx = reply_data["parent"]
                parent_reply_id = reply_id_map.get(parent_idx)

            reply_id = create_reply(cursor, post_id, community_id, reply_author, content,
                                    reply_data["days_ago"], parent_reply_id)
            reply_id_map[i] = reply_id
            stats["replies"] += 1

    return stats


def seed_summer_travelers(cursor, community_id: int, member_usernames: List[str]) -> None:
    """Seed the Summer Travelers community with holiday planning content."""
    print(f"[seed] Seeding Summer Travelers content...")

    total_stats = {"posts": 0, "polls": 0, "replies": 0}

    for conversation in SUMMER_TRAVELERS_CONVERSATION:
        stats = seed_conversation(cursor, community_id, member_usernames, conversation)
        for k, v in stats.items():
            total_stats[k] += v

    # Create calendar event
    event_id = create_calendar_event(cursor, community_id, member_usernames[0], CALENDAR_EVENT)
    print(f"[seed] Created calendar event (id={event_id})")

    print(f"[seed] Summer Travelers: {total_stats['posts']} posts, {total_stats['polls']} polls, {total_stats['replies']} replies")


def seed_future_thinkers(cursor, community_id: int, member_usernames: List[str]) -> None:
    """Seed the Future Thinkers community with intellectual discussion topics."""
    print(f"[seed] Seeding Future Thinkers content...")

    total_stats = {"posts": 0, "polls": 0, "replies": 0}

    for topic_name, conversations in FUTURE_THINKERS_CONVERSATIONS.items():
        for conversation in conversations:
            stats = seed_conversation(cursor, community_id, member_usernames, conversation)
            for k, v in stats.items():
                total_stats[k] += v

    print(f"[seed] Future Thinkers: {total_stats['posts']} posts, {total_stats['replies']} replies across 4 topics")


def seed_enterprise_conversations(cursor, community_id: int, member_usernames: List[str],
                                   conversations: List[Dict], community_name: str) -> None:
    """Seed conversations for enterprise communities."""
    print(f"[seed] Seeding {community_name} content...")

    total_stats = {"posts": 0, "polls": 0, "replies": 0}

    for conversation in conversations:
        stats = seed_conversation(cursor, community_id, member_usernames, conversation)
        for k, v in stats.items():
            total_stats[k] += v

    print(f"[seed] {community_name}: {total_stats['posts']} posts, {total_stats['replies']} replies")


def seed_basic_content(cursor, community_id: int, member_usernames: List[str],
                       community_name: str, conversations: Optional[List[Dict]] = None) -> None:
    """Seed content for communities."""

    if conversations:
        seed_enterprise_conversations(cursor, community_id, member_usernames, conversations, community_name)
        return

    print(f"[seed] Seeding basic content for {community_name}...")

    welcome_post = create_post(
        cursor, community_id, member_usernames[0],
        f"Welcome to {community_name}! Excited to have everyone here. Let's build something amazing together. "
        f"Drop a comment to introduce yourself! 👋",
        30
    )

    # Add reactions from a subset of members
    for reactor in random.sample(member_usernames, min(len(member_usernames), 20)):
        add_reaction(cursor, welcome_post, reactor, random.choice(["like", "love", "celebrate"]))

    # Add some intro replies
    intro_replies = [
        "Excited to be here! Looking forward to connecting with everyone.",
        "Great to join this community. Always looking to learn from others.",
        "Hello everyone! Happy to be part of this group.",
    ]
    for i, reply_text in enumerate(intro_replies[:min(3, len(member_usernames) - 1)]):
        create_reply(cursor, welcome_post, community_id, member_usernames[i + 1], reply_text, 29)

    print(f"[seed] {community_name}: 1 welcome post with engagement")


# ── Cleanup ─────────────────────────────────────────────────────────────


def cleanup(cursor) -> None:
    """Remove all demo data."""
    print("[cleanup] Starting cleanup of demo data...")

    # Find all demo communities (including sub-communities)
    all_community_names = [c["name"] for c in COMMUNITIES]
    for c in COMMUNITIES:
        for sub in c.get("sub_communities", []):
            all_community_names.append(sub["name"])

    placeholders = ", ".join(["%s"] * len(all_community_names))
    cursor.execute(f"SELECT id FROM communities WHERE name IN ({placeholders})", all_community_names)
    community_ids = [row["id"] for row in cursor.fetchall()]

    if community_ids:
        cid_placeholders = ", ".join(["%s"] * len(community_ids))

        # Delete calendar events
        cursor.execute(f"DELETE FROM calendar_events WHERE community_id IN ({cid_placeholders})", community_ids)
        print(f"[cleanup] Deleted calendar events")

        # Delete poll votes, options, polls
        cursor.execute(f"""
            DELETE pv FROM poll_votes pv
            JOIN polls p ON pv.poll_id = p.id
            JOIN posts po ON p.post_id = po.id
            WHERE po.community_id IN ({cid_placeholders})
        """, community_ids)

        cursor.execute(f"""
            DELETE po FROM poll_options po
            JOIN polls p ON po.poll_id = p.id
            JOIN posts pos ON p.post_id = pos.id
            WHERE pos.community_id IN ({cid_placeholders})
        """, community_ids)

        cursor.execute(f"""
            DELETE p FROM polls p
            JOIN posts po ON p.post_id = po.id
            WHERE po.community_id IN ({cid_placeholders})
        """, community_ids)
        print(f"[cleanup] Deleted polls and votes")

        # Delete reactions
        cursor.execute(f"""
            DELETE r FROM reactions r
            JOIN posts p ON r.post_id = p.id
            WHERE p.community_id IN ({cid_placeholders})
        """, community_ids)
        print(f"[cleanup] Deleted reactions")

        # Delete replies
        cursor.execute(f"DELETE FROM replies WHERE community_id IN ({cid_placeholders})", community_ids)
        print(f"[cleanup] Deleted replies")

        # Delete posts
        cursor.execute(f"DELETE FROM posts WHERE community_id IN ({cid_placeholders})", community_ids)
        print(f"[cleanup] Deleted posts")

        # Delete memberships
        cursor.execute(f"DELETE FROM user_communities WHERE community_id IN ({cid_placeholders})", community_ids)
        print(f"[cleanup] Deleted memberships")

        # Delete communities (children first due to FK)
        cursor.execute(f"DELETE FROM communities WHERE parent_community_id IN ({cid_placeholders})", community_ids)
        cursor.execute(f"DELETE FROM communities WHERE id IN ({cid_placeholders})", community_ids)
        print(f"[cleanup] Deleted {len(community_ids)} communities")

    # Delete demo users (by email pattern)
    email_pattern = f"{DEMO_EMAIL_PREFIX}%@{DEMO_EMAIL_DOMAIN}"

    cursor.execute("SELECT username FROM users WHERE email LIKE %s", (email_pattern,))
    demo_usernames = [row["username"] for row in cursor.fetchall()]

    if demo_usernames:
        uname_placeholders = ", ".join(["%s"] * len(demo_usernames))

        # Delete user profiles
        cursor.execute(f"DELETE FROM user_profiles WHERE username IN ({uname_placeholders})", demo_usernames)

        # Delete users
        cursor.execute(f"DELETE FROM users WHERE username IN ({uname_placeholders})", demo_usernames)
        print(f"[cleanup] Deleted {len(demo_usernames)} demo users")

    print("[cleanup] Done!")


# ── Main ────────────────────────────────────────────────────────────────


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed demo communities for investor showcase")
    parser.add_argument("--cleanup", action="store_true", help="Remove all demo data instead of seeding")
    args = parser.parse_args()

    print(f"[seed] Connecting to {DEFAULT_USER}@{DEFAULT_HOST}:{DEFAULT_PORT}/{DEFAULT_DB}")
    conn = get_connection()

    try:
        c = conn.cursor()

        if args.cleanup:
            cleanup(c)
            return

        # 1. Ensure owner exists
        owner_id = ensure_owner(c)

        # 2. Calculate total users needed
        total_members_needed = sum(comm["members"] for comm in COMMUNITIES)
        # Add sub-community members (they'll overlap with parent)
        for comm in COMMUNITIES:
            for sub in comm.get("sub_communities", []):
                total_members_needed += sub["members"]

        print(f"[seed] Need ~{total_members_needed} member slots (with overlap for sub-communities)")

        # 3. Generate users (fewer unique users since they can be in multiple communities)
        unique_users_needed = max(comm["members"] for comm in COMMUNITIES)  # Max of any single community
        users = generate_users(unique_users_needed, exclude_names={OWNER_USERNAME})
        username_to_id = create_users(c, users)

        # Add owner to the mapping
        username_to_id[OWNER_USERNAME] = owner_id

        # 4. Create communities and assign members
        all_usernames = [OWNER_USERNAME] + [u["username"] for u in users]

        for comm in COMMUNITIES:
            # Create main community
            community_id = create_community(c, comm, OWNER_USERNAME)

            # Assign members (take first N from the pool)
            member_usernames = all_usernames[:comm["members"]]
            member_ids = [username_to_id[u] for u in member_usernames]
            added = add_members(c, community_id, member_ids, owner_id)
            print(f"[seed] Added {added} members to '{comm['name']}'")

            # Seed content based on community
            if comm["name"] == "Summer Travelers":
                seed_summer_travelers(c, community_id, member_usernames)
            elif comm["name"] == "Future Thinkers":
                seed_future_thinkers(c, community_id, member_usernames)
            elif comm["name"] == "Growth Network":
                seed_basic_content(c, community_id, member_usernames, comm["name"], GROWTH_NETWORK_CONVERSATIONS)
            elif comm["name"] == "Scale Community":
                seed_basic_content(c, community_id, member_usernames, comm["name"], SCALE_COMMUNITY_CONVERSATIONS)
            elif comm["name"] == "Enterprise Hub":
                seed_basic_content(c, community_id, member_usernames, comm["name"], ENTERPRISE_HUB_CONVERSATIONS)

                # Create sub-communities
                for sub in comm.get("sub_communities", []):
                    sub_community_id = create_community(c, sub, OWNER_USERNAME, parent_id=community_id)

                    # Sub-community members are a subset of parent
                    sub_member_usernames = all_usernames[:sub["members"]]
                    sub_member_ids = [username_to_id[u] for u in sub_member_usernames]
                    sub_added = add_members(c, sub_community_id, sub_member_ids, owner_id)
                    print(f"[seed] Added {sub_added} members to sub-community '{sub['name']}'")

                    # Seed sub-community content
                    if sub["name"] == "Tech Leadership":
                        seed_basic_content(c, sub_community_id, sub_member_usernames, sub["name"], TECH_LEADERSHIP_CONVERSATIONS)
                    elif sub["name"] == "Product Strategy":
                        seed_basic_content(c, sub_community_id, sub_member_usernames, sub["name"], PRODUCT_STRATEGY_CONVERSATIONS)
                    elif sub["name"] == "Sales & Revenue":
                        seed_basic_content(c, sub_community_id, sub_member_usernames, sub["name"], SALES_REVENUE_CONVERSATIONS)
            else:
                seed_basic_content(c, community_id, member_usernames, comm["name"])

        print("\n" + "=" * 60)
        print("[seed] Demo seeding complete!")
        print("=" * 60)
        print(f"\nOwner: @{OWNER_USERNAME}")
        print(f"  Email: {OWNER_EMAIL}")
        print(f"  Password: DemoOwner123!")
        print(f"\nCommunities created: {len(COMMUNITIES)} main + 3 sub-communities")
        print(f"Demo users created: {len(users) + 1}")
        print(f"\nTo cleanup: python scripts/seed_demo_communities.py --cleanup")

    finally:
        conn.close()


if __name__ == "__main__":
    main()
