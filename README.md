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
2. Install Python dependencies: `pip install -r requirements.txt`
3. Install Node.js dependencies: `cd client && npm install`
4. Set up the database: `python init_database.py`
5. Run the Flask server: `python bodybuilding_app.py`
6. Build and run the React client: `cd client && npm run build && npm run preview`

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
