# Links - Fitness & Community Platform

A comprehensive fitness and community platform built with Flask (Python) and React (TypeScript).

## Features

### 🏋️ Fitness & Training
- Workout generation and tracking
- Nutrition planning and analysis
- Blood test analysis
- Weight tracking
- Professional trainer/coach profiles
- CrossFit and gym workout modules

### 👥 Community Features
- Community creation and management
- Discussion feeds with posts and replies
- Private messaging system
- Member management
- Community calendars and events
- Useful links sharing
- Polls and resources

### 💼 Professional Network
- User profiles with professional information
- Skills and experience tracking
- Company and role information

### 💰 Monetization
- Premium subscriptions
- Stripe payment processing

## Tech Stack

**Backend:**
- Flask (Python web framework)
- SQLite/MySQL database
- Redis caching
- OAuth integration
- Stripe payments
- Web Push notifications

**Frontend:**
- React 19 with TypeScript
- React Router for navigation
- TanStack React Query
- Tailwind CSS
- PWA features

## Getting Started

1. Clone the repository
2. Python setup
   - Create venv and install deps
     
     ```bash
     python3 -m venv .venv
     source .venv/bin/activate
     pip install -r requirements.txt
     ```
   - Optional (on Ubuntu/Debian): `sudo apt-get install -y python3-venv`

3. Node.js setup
   - Install deps: `cd client && npm ci`
   - Dev server: `npm run dev -- --host`

4. Run the Flask server (SQLite dev)
   
   ```bash
   # In repo root
   export DEV_MODE=1
   source .venv/bin/activate
   python bodybuilding_app.py
   ```

   - Health check: visit `http://localhost:8080/health`

5. Frontend dev server
   - Vite runs at `http://localhost:5173` (auto-fallback to 5174 if busy)
   - API proxy to Flask is configured in `client/vite.config.ts`

6. Notes
   - Backend DB defaults to SQLite file `users.db` in project root
   - To use MySQL, set env vars: `DB_BACKEND=mysql`, `MYSQL_HOST`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DB`
   - In dev (`DEV_MODE=1`) cookies are non-secure and HTTP is allowed

## Project Structure

```
├── bodybuilding_app.py          # Main Flask application
├── client/                      # React frontend
├── templates/                   # HTML templates
├── static/                      # Static assets
├── *.py                         # Database migration and utility scripts
└── README.md                    # This file
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Commit and push to your fork
5. Create a pull request

## License

This project is private and proprietary.
