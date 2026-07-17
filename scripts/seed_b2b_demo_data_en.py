"""English demo content for the B2B showcase seed (see seed_b2b_demo.py).

Two communities:
  - Northbridge Alumni Network  (75 members, paid L1) — business-school alumni network
  - Riverside Running Club      (25 members, free)    — local running club

All names, companies, and schools are fictional. Author usernames referenced in
THREADS must exist in AUTHORS below (the seed script asserts this).
"""

# ── Community definitions ────────────────────────────────────────────────

ALUMNI_COMMUNITY = {
    "key": "en_alumni",
    "name": "Northbridge Alumni Network",
    "description": (
        "The official alumni community of Northbridge Business School. "
        "Career opportunities, mentorship, chapter events and lifelong connections — "
        "from London to Singapore."
    ),
    "members": 75,
    "paid_tier": "L1",
    "location": "London, United Kingdom",
}

RUNNING_COMMUNITY = {
    "key": "en_running",
    "name": "Riverside Running Club",
    "description": (
        "Friendly community running club by the river. Saturday long runs, Tuesday track "
        "nights, race trips and post-run coffee. All paces welcome."
    ),
    "members": 25,
    "paid_tier": None,
    "location": "Richmond, London",
}

# ── Hand-written author personas ─────────────────────────────────────────
# (username, first, last, gender m/f, age, city, country, role, company,
#  industry, years_exp, skills, degree, school, prev_role, prev_company,
#  interests, bio)

AUTHORS = [
    ("sarah_mitchell", "Sarah", "Mitchell", "f", 34, "London", "United Kingdom",
     "Strategy Director", "Halcyon Partners", "Management Consulting", 11,
     "Corporate strategy, M&A, Workshop facilitation", "MBA", "Northbridge Business School",
     "Engagement Manager", "Bain & Company",
     ["Sailing", "Modern art", "Mentoring"],
     "Strategy director who still gets excited by a good whiteboard session. Class of 2015."),
    ("james_okafor", "James", "Okafor", "m", 38, "London", "United Kingdom",
     "VP Engineering", "Fintraq", "Fintech", 14,
     "Engineering leadership, Payments infrastructure, Hiring", "MSc Computer Science", "Northbridge Business School",
     "Staff Engineer", "Revolut",
     ["Chess", "Five-a-side football", "Angel investing"],
     "Building payment rails at Fintraq. Always happy to talk shop about scaling eng teams."),
    ("priya_shah", "Priya", "Shah", "f", 31, "Manchester", "United Kingdom",
     "Product Lead", "NovaHealth", "Digital Health", 8,
     "Product discovery, Health tech regulation, User research", "MBA", "Northbridge Business School",
     "Senior Product Manager", "Babylon Health",
     ["Trail running", "Cooking", "Podcasts"],
     "Product lead in digital health. Northbridge MBA '19. Ask me about discovery interviews."),
    ("daniel_hughes", "Daniel", "Hughes", "m", 42, "Edinburgh", "United Kingdom",
     "Founder & CEO", "Caledon Analytics", "Data & AI", 17,
     "Founding, B2B sales, Data products", "MBA", "Northbridge Business School",
     "Head of Data", "Skyscanner",
     ["Hillwalking", "Whisky", "Early-stage startups"],
     "Second-time founder. Building Caledon Analytics — decision intelligence for retailers."),
    ("elena_petrova", "Elena", "Petrova", "f", 36, "Berlin", "Germany",
     "Finance Director", "Volt Mobility", "Mobility", 12,
     "FP&A, Fundraising, IFRS", "MSc Finance", "Northbridge Business School",
     "Senior Manager", "KPMG Deal Advisory",
     ["Piano", "Cycling", "Sunday markets"],
     "Finance director at a mobility scale-up in Berlin. Northbridge MSc Finance alum."),
    ("tom_reeves", "Tom", "Reeves", "m", 29, "London", "United Kingdom",
     "Senior Consultant", "Halcyon Partners", "Management Consulting", 6,
     "Due diligence, Retail strategy, Financial modelling", "MBA", "Northbridge Business School",
     "Analyst", "OC&C Strategy",
     ["Marathon running", "Craft beer", "Photography"],
     "Consultant by day, marathoner by dawn. Class of 2022."),
    ("amara_diallo", "Amara", "Diallo", "f", 33, "Paris", "France",
     "Head of Growth", "Lumen Learning", "EdTech", 9,
     "Growth loops, Lifecycle marketing, Analytics", "MBA", "Northbridge Business School",
     "Growth Manager", "Blablacar",
     ["Ceramics", "West African literature", "Yoga"],
     "Growth at Lumen Learning. I care about education that actually reaches people."),
    ("michael_tan", "Michael", "Tan", "m", 40, "Singapore", "Singapore",
     "Partner", "Meridian Capital", "Venture Capital", 15,
     "Series A/B investing, SaaS metrics, Board work", "MBA", "Northbridge Business School",
     "Principal", "Sequoia SEA",
     ["Tennis", "Street food", "Science fiction"],
     "Partner at Meridian Capital in Singapore. Northbridge '12. Coffee always on me for alumni."),
    ("lucy_grant", "Lucy", "Grant", "f", 27, "Bristol", "United Kingdom",
     "Sustainability Manager", "Verdant Foods", "Food & Beverage", 5,
     "Carbon accounting, Supply chain, B Corp certification", "MSc Management", "Northbridge Business School",
     "Consultant", "Anthesis Group",
     ["Wild swimming", "Allotment gardening", "Baking"],
     "Making food supply chains greener. Youngest person in most meetings and fine with it."),
    ("robert_kline", "Robert", "Kline", "m", 47, "New York", "United States",
     "Managing Director", "Ashford & Gray", "Investment Banking", 22,
     "Capital markets, TMT coverage, Negotiation", "MBA", "Northbridge Business School",
     "Director", "Morgan Stanley",
     ["Golf", "Jazz", "College basketball"],
     "MD at Ashford & Gray in NYC. Northbridge class of '04 — happy to help younger alumni land in the US."),
    ("hannah_wolfe", "Hannah", "Wolfe", "f", 30, "Amsterdam", "Netherlands",
     "People Director", "Canalside", "E-commerce", 8,
     "Org design, Compensation, Leadership coaching", "MBA", "Northbridge Business School",
     "HR Business Partner", "Booking.com",
     ["Bouldering", "Vintage furniture", "Documentaries"],
     "People director at Canalside. I think culture is a product and we should ship it deliberately."),
    ("david_osei", "David", "Osei", "m", 35, "London", "United Kingdom",
     "Marketing Director", "Brewhouse & Co", "Consumer Goods", 11,
     "Brand strategy, Retail media, Team leadership", "MBA", "Northbridge Business School",
     "Senior Brand Manager", "Unilever",
     ["Running", "Vinyl records", "Sunday roasts"],
     "Brand builder. Northbridge '16. Also found at Riverside parkrun most Saturdays."),
    # Running club authors (non-alumni)
    ("kate_holloway", "Kate", "Holloway", "f", 38, "Richmond", "United Kingdom",
     "Physiotherapist", "Riverside Physio Clinic", "Healthcare", 14,
     "Sports rehabilitation, Gait analysis, Strength training", "BSc Physiotherapy", "King's College London",
     "Physiotherapist", "NHS St George's",
     ["Marathons", "Open-water swimming", "Dogs"],
     "Club captain and physio — I fix the injuries this club gives you. 3:12 marathoner."),
    ("steve_barnes", "Steve", "Barnes", "m", 51, "Twickenham", "United Kingdom",
     "Secondary School Teacher", "Orleans Park School", "Education", 27,
     "Mathematics, Coaching, Timetabling miracles", "PGCE", "Institute of Education",
     "Teacher", "Grey Court School",
     ["Coaching juniors", "Real ale", "Quizzes"],
     "Maths teacher, run coach, keeper of the club pace charts. Sub-40 10K (2009, still counts)."),
    ("nina_kovacs", "Nina", "Kovacs", "f", 26, "Kingston", "United Kingdom",
     "UX Designer", "Mapledown Studio", "Design", 4,
     "Interaction design, Design systems, Prototyping", "BA Design", "Kingston University",
     "Junior Designer", "AKQA",
     ["Trail races", "Film photography", "Plants"],
     "Designer who took up running during lockdown and never stopped. Chasing a sub-45 10K."),
    ("raj_patel", "Raj", "Patel", "m", 44, "Richmond", "United Kingdom",
     "GP", "Sheen Lane Surgery", "Healthcare", 18,
     "General practice, Sports medicine, Public health", "MBBS", "Imperial College London",
     "GP Registrar", "NHS Kingston",
     ["Half marathons", "Cricket", "Cooking"],
     "Local GP. I prescribe parkrun. Occasionally take my own medicine."),
    ("emma_walsh", "Emma", "Walsh", "f", 32, "Teddington", "United Kingdom",
     "Solicitor", "Harrow & Finch LLP", "Legal", 9,
     "Commercial contracts, Data protection, Negotiation", "LLB", "University of Bristol",
     "Associate", "Clifford Chance",
     ["10Ks", "Choir", "Crosswords"],
     "Lawyer, alto, back-of-the-pack convert now mid-pack and proud."),
]

# Overlap: david_osei and tom_reeves are in BOTH alumni and running club (realistic).
ALUMNI_AUTHORS = ["sarah_mitchell", "james_okafor", "priya_shah", "daniel_hughes",
                  "elena_petrova", "tom_reeves", "amara_diallo", "michael_tan",
                  "lucy_grant", "robert_kline", "hannah_wolfe", "david_osei"]
RUNNING_AUTHORS = ["kate_holloway", "steve_barnes", "nina_kovacs", "raj_patel",
                   "emma_walsh", "david_osei", "tom_reeves"]

# ── Filler pools (remaining members get generated profiles) ─────────────

FILLER_FIRST_M = ["Oliver", "Jack", "Harry", "Charlie", "Thomas", "George", "Oscar", "William",
                  "Noah", "Leo", "Ethan", "Lucas", "Adam", "Ben", "Sam", "Max", "Daniel", "Ryan",
                  "Kevin", "Marcus", "Andre", "Felix", "Hugo", "Arthur", "Theo", "Finn", "Jason",
                  "Carl", "Victor", "Simon"]
FILLER_FIRST_F = ["Olivia", "Amelia", "Isla", "Ava", "Emily", "Sophia", "Grace", "Lily",
                  "Freya", "Chloe", "Zoe", "Ruby", "Alice", "Megan", "Lauren", "Holly", "Anna",
                  "Clara", "Nadia", "Rachel", "Naomi", "Jessica", "Erin", "Rosa", "Maya", "Leila",
                  "Carmen", "Ingrid", "Tara", "Beth"]
FILLER_LAST = ["Bennett", "Carter", "Dawson", "Ellis", "Foster", "Gibson", "Harper", "Ingram",
               "Jennings", "Keller", "Lawson", "Mercer", "Nolan", "Osborne", "Prescott", "Quinn",
               "Radcliffe", "Sinclair", "Thorne", "Underwood", "Vaughan", "Whitfield", "Yates",
               "Ashworth", "Blackwood", "Crawford", "Drummond", "Everett", "Fairbank", "Goodwin",
               "Hastings", "Irving", "Jephson", "Kingsley", "Lockhart", "Middleton", "Norris",
               "Ogilvy", "Pemberton", "Rutherford"]

ALUMNI_FILLER_ROLES = [
    ("Senior Consultant", "Calder Advisory", "Management Consulting"),
    ("Product Manager", "Loopwire", "SaaS"),
    ("Investment Associate", "Greystone Capital", "Private Equity"),
    ("Marketing Manager", "Fable & Frame", "Media"),
    ("Operations Director", "Swiftline Logistics", "Logistics"),
    ("Data Scientist", "Herondata", "Data & AI"),
    ("Corporate Lawyer", "Weston Barr LLP", "Legal"),
    ("Finance Manager", "Alderway Group", "Financial Services"),
    ("Founder", "Bloomfield Labs", "Startups"),
    ("HR Director", "Portman Retail", "Retail"),
    ("Account Director", "Kestrel Media", "Advertising"),
    ("Supply Chain Manager", "Verdant Foods", "Food & Beverage"),
    ("Business Development Lead", "Northgate Energy", "Energy"),
    ("Programme Manager", "CivicWorks", "Public Sector"),
    ("Equity Analyst", "Marlow Securities", "Investment Management"),
]
ALUMNI_FILLER_CITIES = ["London", "Manchester", "Edinburgh", "Dublin", "Paris", "Amsterdam",
                        "Frankfurt", "Zurich", "New York", "Boston", "Singapore", "Dubai",
                        "Madrid", "Stockholm", "Toronto", "Lisbon"]
ALUMNI_FILLER_DEGREES = [("MBA", "Northbridge Business School"),
                         ("MSc Finance", "Northbridge Business School"),
                         ("MSc Management", "Northbridge Business School"),
                         ("Executive MBA", "Northbridge Business School")]
ALUMNI_FILLER_BIOS = [
    "Northbridge alum ({year}). {role} focused on {focus}. Always up for a coffee with fellow alumni.",
    "{role} at {company}. Northbridge {year}. Interested in {focus} and good conversation.",
    "Class of {year}. Working on {focus} at {company}. Mentoring first-gen students when I can.",
    "{role} · {city}. Northbridge {year}. Ask me about {focus}.",
]
ALUMNI_FILLER_FOCUS = ["go-to-market strategy", "digital transformation", "sustainable growth",
                       "emerging markets", "product-led growth", "post-merger integration",
                       "climate finance", "consumer insights", "operational excellence",
                       "venture building"]

RUNNING_FILLER_ROLES = [
    ("Software Engineer", "Datashift", "Technology"),
    ("Nurse", "Kingston Hospital", "Healthcare"),
    ("Accountant", "Fenwick & Moore", "Accounting"),
    ("Architect", "Studio Merton", "Architecture"),
    ("Primary Teacher", "St Luke's Primary", "Education"),
    ("Barista & Manager", "The Towpath Café", "Hospitality"),
    ("Civil Servant", "Department for Transport", "Public Sector"),
    ("Recruiter", "Bridgewater Talent", "Recruitment"),
    ("Pharmacist", "Sheen Pharmacy", "Healthcare"),
    ("Journalist", "Richmond Courier", "Media"),
]
RUNNING_FILLER_CITIES = ["Richmond", "Twickenham", "Kingston", "Teddington", "Sheen", "Barnes",
                         "Mortlake", "Hampton"]
RUNNING_FILLER_BIOS = [
    "{role} and weekend runner. Current goal: {goal}. Post-run coffee is mandatory.",
    "Running with Riverside since {year}. {goal} in progress. {role} the rest of the week.",
    "{role} from {city}. Joined for the fitness, stayed for the people. {goal}.",
]
RUNNING_FILLER_GOALS = ["first half marathon", "sub-25 5K", "sub-50 10K", "a full marathon",
                        "100 parkruns", "staying injury-free", "the club relay team"]

# ── Feed threads (oldest first — the feed sorts by id DESC) ─────────────
# thread = {"post": {"author", "content", "days_ago"}, "replies": [...],
#           "hearts": N} or {"poll": {...}} ; replies may nest via "parent" index.
# "author": "OWNER" = community owner (Paulo).

ALUMNI_THREADS = [
    {"post": {"author": "OWNER",
              "content": "Welcome to the new home of the Northbridge Alumni Network! 🎓\n\nWe've moved the community here so everything lives in one place — discussions, mentorship, job opportunities and chapter events.\n\nTo get us started: drop a quick intro below. Class year, where you are now, and one thing fellow alumni can ask you about.",
              "days_ago": 29},
     "hearts": 31,
     "replies": [
         {"author": "sarah_mitchell", "content": "Love this. Sarah, class of 2015, Strategy Director at Halcyon in London. Ask me anything about consulting careers or surviving a case interview.", "days_ago": 29},
         {"author": "michael_tan", "content": "Michael Tan, '12, Partner at Meridian Capital in Singapore. Happy to talk early-stage fundraising in SEA — and to host anyone passing through.", "days_ago": 29},
         {"author": "robert_kline", "content": "Class of '04, MD at Ashford & Gray in New York. If you're an alum trying to break into US capital markets, my inbox is open.", "days_ago": 28},
         {"author": "lucy_grant", "content": "Lucy, MSc Management '21 — sustainability at Verdant Foods in Bristol. Ask me about carbon accounting before it becomes your problem too 😄", "days_ago": 28},
         {"author": "amara_diallo", "content": "Amara, MBA '18, growth at Lumen Learning in Paris. Also coordinating the Paris chapter drinks — announcement coming soon!", "days_ago": 28},
     ]},
    {"post": {"author": "priya_shah",
              "content": "Job opportunity at NovaHealth 🏥 — we're hiring a Senior Product Manager for our remote monitoring platform (Manchester or hybrid).\n\nSeries B, real clinical impact, and a product team that actually talks to users. JD on our careers page — or message me directly. Alumni referrals get fast-tracked, obviously.",
              "days_ago": 26},
     "hearts": 18,
     "replies": [
         {"author": "hannah_wolfe", "content": "Sharing this with two former colleagues who'd be perfect. What's the interview loop like?", "days_ago": 26},
         {"author": "priya_shah", "content": "Screening call, product case (take-home, 2h max, we respect your weekend), then a panel. Three weeks end to end.", "days_ago": 26, "parent": 0},
         {"author": "james_okafor", "content": "\"Take-home capped at 2h\" — more of this in hiring, please. 👏", "days_ago": 25},
     ]},
    {"post": {"author": "daniel_hughes",
              "content": "Founder update, 18 months in: Caledon Analytics just signed our first two grocery chains. 🎉\n\nThings I wish I'd known at the start:\n1. Your first sales hire should come after YOU'VE closed 10 deals, not before.\n2. Retail buyers don't buy dashboards, they buy margin.\n3. The Northbridge network is absurdly underused — half our pipeline came from alumni intros.\n\nHappy to go deeper if useful.",
              "days_ago": 23},
     "hearts": 42,
     "replies": [
         {"author": "michael_tan", "content": "Congrats Daniel! Point 1 is the most expensive lesson in B2B. When you're ready for a Series A conversation, you know where I am.", "days_ago": 23},
         {"author": "daniel_hughes", "content": "Ha — noted, Michael. Let's talk after Q3 numbers land.", "days_ago": 23, "parent": 0},
         {"author": "sarah_mitchell", "content": "Would love a longer write-up on point 2. That framing applies to consulting proposals too.", "days_ago": 22},
         {"author": "elena_petrova", "content": "The alumni-intro pipeline stat is real. We filled our last two finance roles through this network.", "days_ago": 22},
     ]},
    {"poll": {"author": "OWNER",
              "question": "Where should we host the 2026 Autumn Reunion? Top two cities get a full proposal from the events committee.",
              "options": ["London — back to campus", "Lisbon — chapter offer to host", "Berlin — central & affordable", "Singapore — first time in Asia"],
              "days_ago": 21,
              "votes_weights": [0.42, 0.28, 0.18, 0.12]}},
    {"post": {"author": "OWNER",
              "content": "📣 Mentorship Programme 2026 is open!\n\nWe're pairing experienced alumni with recent graduates for a 6-month cycle: one hour a month, structured goals, zero fluff. Last year 84% of mentees said it changed their career trajectory.\n\nMentors and mentees: sign-up links in the event details. Kickoff webinar next Thursday — add it to your calendar from the Events tab.",
              "days_ago": 18},
     "hearts": 27,
     "replies": [
         {"author": "robert_kline", "content": "Signed up as a mentor again. Third year running — best hour a month on my calendar.", "days_ago": 18},
         {"author": "nina_filler_slot", "content": "__SKIP__", "days_ago": 18},
         {"author": "tom_reeves", "content": "Was a mentee in 2023, mentor this year. Full circle moment. Do it, people.", "days_ago": 17},
         {"author": "amara_diallo", "content": "Any chance of a track for alumni switching industries rather than just levels? That transition is where I needed the most help.", "days_ago": 17},
         {"author": "OWNER", "content": "Great shout, Amara — adding an industry-switchers track to the matching form now.", "days_ago": 17, "parent": 3},
     ]},
    {"post": {"author": "elena_petrova",
              "content": "We just closed our Series C at Volt (€85M). AMA about scale-up fundraising in this market, from the finance seat.\n\nShort version: diligence is 3x heavier than 2021, terms are sane again, and your data room is your first impression. Happy to answer specifics.",
              "days_ago": 15},
     "hearts": 35,
     "replies": [
         {"author": "daniel_hughes", "content": "Congrats! How early did you start building the data room before the raise?", "days_ago": 15},
         {"author": "elena_petrova", "content": "Six months. We treated it as a permanent asset, not a raise artifact — updated monthly since. Made the actual process almost boring.", "days_ago": 15, "parent": 0},
         {"author": "michael_tan", "content": "Can confirm the investor side of this: a clean, current data room moves you to the top of the pile instantly.", "days_ago": 14},
         {"author": "lucy_grant", "content": "Did ESG metrics come up in diligence? Hearing mixed things about whether funds actually weigh them.", "days_ago": 14},
         {"author": "elena_petrova", "content": "They did — two of three term sheets had ESG covenants. Lightweight, but real. Happy to share the metric list privately.", "days_ago": 14, "parent": 3},
     ]},
    {"post": {"author": "david_osei",
              "content": "Unpopular opinion from 11 years in brand: most 'brand refreshes' are expensive procrastination.\n\nIf sales are soft, the answer is almost never the logo. It's distribution, pricing, or the product itself. A refresh feels like action while avoiding the hard conversation.\n\nFight me in the comments (politely, we're alumni). 😄",
              "days_ago": 12},
     "hearts": 24,
     "replies": [
         {"author": "sarah_mitchell", "content": "Strategy consultant cosigns. 'Rebrand' appears in the deck exactly when nobody wants to say 'our product lost'.", "days_ago": 12},
         {"author": "amara_diallo", "content": "Counterpoint: when we repositioned Lumen from 'courses' to 'careers', same product, revenue doubled. Positioning ≠ logo though — maybe we agree.", "days_ago": 11},
         {"author": "david_osei", "content": "We fully agree — repositioning is strategy. The €400k logo-and-font exercise is the procrastination part.", "days_ago": 11, "parent": 1},
     ]},
    {"post": {"author": "OWNER",
              "content": "Chapter update 🌍\n\n• London: 340 members, monthly drinks now at The Anchor & Hope (first Thursday)\n• Paris: new chapter lead — merci Amara! Kickoff apéro on the 24th\n• Singapore: Michael hosting a fintech roundtable next month\n• New York: careers panel with Robert's team in September\n\nWant to start a chapter in your city? You need five alumni and a venue — we handle the rest.",
              "days_ago": 9},
     "hearts": 29,
     "replies": [
         {"author": "amara_diallo", "content": "Paris apéro is ON. 30 spots, 22 already claimed — RSVP on the event.", "days_ago": 9},
         {"author": "hannah_wolfe", "content": "Five alumni in Amsterdam confirmed over one WhatsApp message. Consider this our application. 🇳🇱", "days_ago": 8},
         {"author": "OWNER", "content": "Amsterdam chapter: approved. That was the fastest one yet — DM incoming, Hannah.", "days_ago": 8, "parent": 1},
     ]},
    {"post": {"author": "james_okafor",
              "content": "Hiring thread 🧵 — post your open roles below, one comment per company. I'll start:\n\nFintraq (London/hybrid): Senior Backend Engineer (Go), Platform SRE, and an Engineering Manager for our payments team. We sponsor visas and the coffee machine is genuinely excellent.",
              "days_ago": 6},
     "hearts": 21,
     "replies": [
         {"author": "priya_shah", "content": "NovaHealth (Manchester/hybrid): Senior PM (posted above — still open!), plus a Clinical Data Analyst and a UX Researcher.", "days_ago": 6},
         {"author": "daniel_hughes", "content": "Caledon Analytics (Edinburgh/remote UK): Founding Account Executive and a Senior Data Engineer. Equity that means something.", "days_ago": 6},
         {"author": "robert_kline", "content": "Ashford & Gray (NYC): TMT Associate, 3-5 yrs experience. Brutal hours, unbeatable deal flow — you know the trade.", "days_ago": 5},
         {"author": "elena_petrova", "content": "Volt Mobility (Berlin): FP&A Manager and a Treasury Analyst. German not required, Excel discipline very much required.", "days_ago": 5},
     ]},
    {"post": {"author": "lucy_grant",
              "content": "Small win worth sharing: Verdant just got B Corp certified after 14 months of work. 🌱\n\nTo every alum who answered my panicked questions along the way — the supply-chain audit nearly broke me twice — this network genuinely carried the project. Write-up of the process coming to the resources section.",
              "days_ago": 4},
     "hearts": 33,
     "replies": [
         {"author": "hannah_wolfe", "content": "Huge, Lucy! We're starting the process at Canalside next quarter — that write-up will be gold.", "days_ago": 4},
         {"author": "OWNER", "content": "Congratulations Lucy — and yes please on the write-up, I'll pin it to the community resources.", "days_ago": 3},
         {"author": "tom_reeves", "content": "Client of ours went through this last year, seconding that the supply-chain stage is the boss level. Well earned. 👏", "days_ago": 3},
     ]},
    {"poll": {"author": "sarah_mitchell",
              "question": "Next masterclass topic — the events committee will book the speaker with the most votes:",
              "options": ["Negotiating executive comp", "AI tools for strategy work", "Board seats: getting your first", "Storytelling for leaders"],
              "days_ago": 3,
              "votes_weights": [0.22, 0.38, 0.25, 0.15]}},
    {"post": {"author": "michael_tan",
              "content": "Flying into London for next week's board meetings — staying through the weekend for the alumni gala. Who else is going? Let's get a proper Singapore-chapter table organised. 🥂",
              "days_ago": 1},
     "hearts": 14,
     "replies": [
         {"author": "sarah_mitchell", "content": "Going! Table for the classes of '12-'15 or it didn't happen.", "days_ago": 1},
         {"author": "james_okafor", "content": "In. And I owe you a coffee from your last intro, Michael — it turned into our new EM.", "days_ago": 1},
         {"author": "OWNER", "content": "120 tickets gone, 30 left — if you're reading this and haven't booked, the Events tab is right there. 👀", "days_ago": 0},
     ]},
]

ALUMNI_FRESH_THREADS = [
    {"post": {"author": "OWNER",
              "content": "Mentor onboarding session wrapped up an hour ago — 40 mentors confirmed for the 2026 cycle, our biggest cohort yet. Matching results go out Friday. 🎓",
              "days_ago": 0.14},
     "hearts": 9,
     "replies": [
         {"author": "hannah_wolfe", "content": "That was a genuinely useful session — the matching criteria make so much more sense now.", "days_ago": 0.10},
         {"author": "robert_kline", "content": "40 mentors! Remember when we struggled to find 12? This network has grown up.", "days_ago": 0.05},
     ]},
    {"post": {"author": "priya_shah",
              "content": "Sitting in the audience at HealthTech Europe and a Northbridge alum is on stage, one is moderating, and one just asked the sharpest question of the panel. We're everywhere. 😄 Anyone else here today?",
              "days_ago": 0.35},
     "hearts": 12,
     "replies": [
         {"author": "amara_diallo", "content": "Ha! I'm at the Lumen booth — come say hi, I'll trade you a coffee for product gossip.", "days_ago": 0.30},
         {"author": "priya_shah", "content": "Deal. Heading over after this panel.", "days_ago": 0.27, "parent": 0},
     ]},
]

SUB_COMMUNITIES = [
    {"key": "en_sub_london",
     "name": "London Chapter",
     "members": 40,
     "location": "London, United Kingdom",
     "description": "The London arm of the Northbridge Alumni Network — monthly drinks at The Anchor & Hope, career panels, and the occasional five-a-side humiliation.",
     "include_authors": ["sarah_mitchell", "james_okafor", "david_osei", "tom_reeves", "lucy_grant", "priya_shah"],
     "threads": [
         {"post": {"author": "sarah_mitchell",
                   "content": "First-Thursday drinks are back at The Anchor & Hope this week — upstairs room booked from 6:30pm. Newcomers: look for the table with the Northbridge banner and too many consultants.",
                   "days_ago": 4},
          "hearts": 14,
          "replies": [
              {"author": "david_osei", "content": "Bringing two colleagues who are considering the Executive MBA — be nice, we're recruiting for the alma mater.", "days_ago": 4},
              {"author": "tom_reeves", "content": "In! And I'm claiming the corner seat before the bankers do.", "days_ago": 3},
          ]},
         {"post": {"author": "james_okafor",
                   "content": "London folks — Fintraq has 4 spare desks in our Shoreditch office through September. If any alum is between offices or visiting, they're yours. Good coffee, decent wifi, questionable playlist.",
                   "days_ago": 2},
          "hearts": 16,
          "replies": [
              {"author": "lucy_grant", "content": "This is the kind of alumni perk nobody puts in the brochure. Taking you up on this next month, James.", "days_ago": 2},
              {"author": "sarah_mitchell", "content": "The playlist disclaimer is doing a lot of work here 😂", "days_ago": 1},
          ]},
         {"post": {"author": "tom_reeves",
                   "content": "Who's around for a pre-gala coffee tomorrow afternoon? A few of us are meeting at Monmouth on Borough Market at 3pm before heading to The Landmark. ☕",
                   "days_ago": 0.25},
          "hearts": 7,
          "replies": [
              {"author": "priya_shah", "content": "Train gets in at 2:40 — I'll be there, possibly still holding my suitcase.", "days_ago": 0.18},
              {"author": "david_osei", "content": "Count me in. First round of flat whites on me.", "days_ago": 0.08},
          ]},
     ]},
    {"key": "en_sub_founders",
     "name": "Founders & Investors Circle",
     "members": 18,
     "location": "Global",
     "description": "A smaller room for alumni building or backing companies. Monthly metrics clinics, honest post-mortems, and warm intros that actually happen.",
     "include_authors": ["daniel_hughes", "michael_tan", "elena_petrova", "robert_kline", "james_okafor", "amara_diallo"],
     "threads": [
         {"post": {"author": "michael_tan",
                   "content": "Metrics clinic #7, this Friday, 1pm UK time: bring ONE number you don't like and we workshop it. Last month someone's churn problem turned out to be an onboarding problem in a 40-minute session. This format works.",
                   "days_ago": 5},
          "hearts": 11,
          "replies": [
              {"author": "daniel_hughes", "content": "That someone was me, and the fix shipped last week. Retention +6pts. Bring your ugly numbers, people.", "days_ago": 5},
              {"author": "elena_petrova", "content": "Joining with a CAC payback question that keeps me up at night.", "days_ago": 4},
          ]},
         {"post": {"author": "daniel_hughes",
                   "content": "Honest question for the circle: first board meeting after raising — what do you wish you'd done differently? Ours is in three weeks and I'd rather learn from your scars than mine.",
                   "days_ago": 1},
          "hearts": 9,
          "replies": [
              {"author": "michael_tan", "content": "Send the deck 72h before, not the night before. Half of a bad board meeting is surprise, not substance.", "days_ago": 1},
              {"author": "robert_kline", "content": "Decide what you WANT from them before you walk in. A board without asks becomes a board with opinions.", "days_ago": 0.8},
              {"author": "elena_petrova", "content": "Bring your CFO (or whoever owns the model) for the numbers section. Founders narrating spreadsheets is where credibility goes to die.", "days_ago": 0.5},
          ]},
     ]},
]

ALUMNI_EVENTS = [
    {"title": "Annual Alumni Gala 2026",
     "days_ahead": 9, "time": "19:00", "duration_h": 5,
     "location": "The Landmark Hotel, London",
     "description": "Black tie, 150 alumni, live band, and the annual awards. Includes drinks reception and three-course dinner. Partners welcome.",
     "rsvp_going": 34, "rsvp_maybe": 9},
    {"title": "Mentorship Programme Kickoff (Webinar)",
     "days_ahead": 3, "time": "18:00", "duration_h": 1,
     "location": "Online — link in event",
     "description": "How the 2026 cycle works, matching criteria, and a Q&A with last year's standout pairs. Recording available for those who can't make it live.",
     "rsvp_going": 52, "rsvp_maybe": 11},
    {"title": "Paris Chapter Apéro",
     "days_ahead": 14, "time": "19:30", "duration_h": 3,
     "location": "Le Perchoir Marais, Paris",
     "description": "Kickoff drinks for the relaunched Paris chapter, hosted by Amara Diallo. First round on the alumni association.",
     "rsvp_going": 22, "rsvp_maybe": 5},
    {"title": "NYC Careers Panel: Breaking into US Finance",
     "days_ahead": 27, "time": "18:30", "duration_h": 2,
     "location": "Ashford & Gray, 200 Park Ave, New York",
     "description": "Robert Kline hosts a panel with four alumni working across banking, PE and asset management. Aimed at alumni within 5 years of graduation.",
     "rsvp_going": 18, "rsvp_maybe": 7},
]

ALUMNI_LINKS = [
    {"url": "https://www.northbridge-alumni.example.com/mentorship", "description": "Mentorship Programme 2026 — sign-up form and matching criteria"},
    {"url": "https://www.northbridge-alumni.example.com/gala", "description": "Annual Gala — tickets and table booking"},
    {"url": "https://www.northbridge-alumni.example.com/directory", "description": "Global alumni directory (login with your alumni email)"},
]

RUNNING_THREADS = [
    {"post": {"author": "OWNER",
              "content": "Welcome to the Riverside Running Club community! 🏃\n\nEverything club-related now lives here: training plans, race trips, social runs and the all-important coffee decisions.\n\nHouse rules: every pace is a good pace, nobody gets left behind on a long run, and race photos must be posted no matter how bad they are.",
              "days_ago": 28},
     "hearts": 19,
     "replies": [
         {"author": "kate_holloway", "content": "Captain's addendum: 'every pace' includes the day after a marathon. Waddling counts.", "days_ago": 28},
         {"author": "steve_barnes", "content": "Pace charts are pinned to my fridge and now to this community. No excuses, people.", "days_ago": 27},
         {"author": "nina_kovacs", "content": "Joined 8 months ago barely able to run 2K without stopping. This club is the best thing I did all year. 🧡", "days_ago": 27},
     ]},
    {"post": {"author": "kate_holloway",
              "content": "Saturday long run 📋 — 7:30am from the boathouse.\n\nGroup A: 24K steady (marathon block week 6)\nGroup B: 16K easy\nGroup C: 10K social, walk breaks welcome\n\nRoute follows the river to Hampton and back. Café stop confirmed at the Towpath — they're expecting all of us this time, I apologised for last month.",
              "days_ago": 24},
     "hearts": 15,
     "replies": [
         {"author": "raj_patel", "content": "Group B for me — on call at 2pm so need to be done by 10.", "days_ago": 24},
         {"author": "emma_walsh", "content": "Group C represent. We're the group that actually enjoys ourselves.", "days_ago": 24},
         {"author": "tom_reeves", "content": "24K 😅 marathon training is a scam I willingly signed up for. See you at 7:30.", "days_ago": 23},
     ]},
    {"post": {"author": "nina_kovacs",
              "content": "RACE REPORT: Kingston 10K 🏁\n\n44:52!!! Sub-45 DONE. Eight months ago my 10K PB was 58 minutes.\n\nThank you Steve for the interval torture, Kate for fixing my calf in week 3, and everyone who ran the last rep with me on Tuesdays. Official photos show me either crying or dying, possibly both. Posting anyway as per club rules.",
              "days_ago": 20},
     "hearts": 23,
     "replies": [
         {"author": "steve_barnes", "content": "PROUD COACH MOMENT. Next stop: sub-43. (You have until spring, it's in the spreadsheet.)", "days_ago": 20},
         {"author": "kate_holloway", "content": "That calf held because you actually did the boring rehab exercises. Star pupil. 🌟", "days_ago": 20},
         {"author": "emma_walsh", "content": "Crying AND dying is the only acceptable race photo. Massive congrats Nina!", "days_ago": 19},
         {"author": "raj_patel", "content": "Brilliant run! That negative split in the second half was textbook.", "days_ago": 19},
     ]},
    {"poll": {"author": "steve_barnes",
              "question": "Summer schedule vote: what time should the Saturday long run start from June?",
              "options": ["7:00 — beat the heat", "7:30 — keep it as is", "8:00 — it's the weekend, relax"],
              "days_ago": 16,
              "votes_weights": [0.45, 0.35, 0.20]}},
    {"post": {"author": "raj_patel",
              "content": "GP + runner PSA as the temperatures climb: 🌡️\n\n• Hydrate BEFORE the run, not just during\n• The group WhatsApp saying 'it's fine, it's shady by the river' is not a medical opinion\n• If you feel dizzy or stop sweating, stop running. Not negotiable.\n\nThat's it. That's the post. See you Saturday.",
              "days_ago": 13},
     "hearts": 18,
     "replies": [
         {"author": "kate_holloway", "content": "Co-signed by your club physio. Also: electrolytes are not just for influencers.", "days_ago": 13},
         {"author": "steve_barnes", "content": "Adding this to the pinned pace chart with a laminated cover. You know it's serious when it's laminated.", "days_ago": 12},
     ]},
    {"post": {"author": "emma_walsh",
              "content": "Shoe thread, because my beloved Pegasus have died at 812km (RIP 🥀).\n\nWhat's everyone running in these days? Needs: mild overpronation support, survives towpath gravel, under £140. And no, Steve, 'the shoes you already have' is not a model name.",
              "days_ago": 9},
     "hearts": 12,
     "replies": [
         {"author": "tom_reeves", "content": "Saucony Guide 17 — ticks all three boxes and they're on sale at the Kingston running shop with the club discount.", "days_ago": 9},
         {"author": "nina_kovacs", "content": "Second the Guide. Also the club discount code works online, learned that too late 😭", "days_ago": 9, "parent": 0},
         {"author": "steve_barnes", "content": "812km is 312km past my official recommendation and you KNOW this, Emma.", "days_ago": 8},
         {"author": "emma_walsh", "content": "The laminator has made you drunk with power.", "days_ago": 8, "parent": 2},
     ]},
    {"post": {"author": "steve_barnes",
              "content": "Track night update: Tuesdays 7pm, Teddington track, all summer. 🏟️\n\nThis block we're building toward the club relay in September: 6×800m at 5K effort, full recovery. Beginners group does 6×400m — Nina used to be in that group and look at her now.\n\nFirst-timers: just show up, no booking. Bring water and low expectations, leave with neither.",
              "days_ago": 5},
     "hearts": 16,
     "replies": [
         {"author": "nina_kovacs", "content": "Can confirm the beginners group is where the magic starts. Also 'leave with neither' 😂", "days_ago": 5},
         {"author": "david_osei", "content": "Finally free on Tuesdays again — count me in for the 800s. Be gentle.", "days_ago": 4},
         {"author": "steve_barnes", "content": "I am never gentle. Welcome back David.", "days_ago": 4, "parent": 1},
     ]},
    {"poll": {"author": "kate_holloway",
              "question": "Club trip: which autumn half marathon should we book the minibus for?",
              "options": ["Oxford Half — flat & fast", "Bath Half — great crowd support", "Great North Run — the big one", "Richmond Half — sleep in our own beds"],
              "days_ago": 3,
              "votes_weights": [0.30, 0.20, 0.35, 0.15]}},
    {"post": {"author": "OWNER",
              "content": "Club admin, the fun kind 📊\n\nWe crossed 25 members this month — welcome to everyone who joined after the summer fair! A few notes:\n\n• Subs stay £3/month, still mostly funding post-run flapjacks\n• New member welcome run: this Saturday, Group C, I'm leading it personally\n• The relay team sheet for September goes up next week — Steve says 'start doing your 800s'\n\nGood to have you all here. 🧡",
              "days_ago": 1},
     "hearts": 17,
     "replies": [
         {"author": "kate_holloway", "content": "Welcome new folks! Find me if anything hurts — before it becomes interesting, ideally.", "days_ago": 1},
         {"author": "emma_walsh", "content": "The flapjack budget transparency is why I trust this club's leadership.", "days_ago": 0},
     ]},
]

RUNNING_FRESH_THREADS = [
    {"post": {"author": "kate_holloway",
              "content": "Morning run done, route recce complete: Saturday's long run gets the NEW towpath section past the lock — freshly resurfaced, zero ankle-breaking gravel. Small joys. 🏃‍♀️",
              "days_ago": 0.28},
     "hearts": 8,
     "replies": [
         {"author": "emma_walsh", "content": "The gravel section claiming its last victim (me, twice) is the end of an era.", "days_ago": 0.2},
         {"author": "steve_barnes", "content": "Updating the route map tonight. Laminated, obviously.", "days_ago": 0.1},
     ]},
]

RUNNING_EVENTS = [
    {"title": "Saturday Long Run — Boathouse",
     "days_ahead": 2, "time": "07:30", "duration_h": 2,
     "location": "Riverside Boathouse, Richmond",
     "description": "Groups A (24K), B (16K) and C (10K social). Café stop at the Towpath on the way back. New members: Group C, Paulo is leading.",
     "rsvp_going": 16, "rsvp_maybe": 4},
    {"title": "Track Night — Teddington",
     "days_ahead": 5, "time": "19:00", "duration_h": 1,
     "location": "Teddington Athletics Track",
     "description": "6×800m @ 5K effort (beginners: 6×400m). No booking needed, bring water.",
     "rsvp_going": 12, "rsvp_maybe": 3},
    {"title": "Club Relay Championships",
     "days_ahead": 24, "time": "10:00", "duration_h": 4,
     "location": "Bushy Park",
     "description": "Teams of 4 × 5K. Team sheet announced next week — bribing the captain with flapjacks is encouraged but ineffective.",
     "rsvp_going": 14, "rsvp_maybe": 6},
]

RUNNING_LINKS = [
    {"url": "https://www.riversiderunners.example.com/pace-charts", "description": "Steve's official pace charts (laminated edition)"},
    {"url": "https://www.riversiderunners.example.com/membership", "description": "Membership & subs — £3/month"},
]
