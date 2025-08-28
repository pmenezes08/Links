# Local Development Guide

This guide will help you set up and use a local development environment for the Bodybuilding App, allowing you to develop safely without impacting the production environment.

## 🚀 Quick Start

### 1. Initial Setup

```bash
# Run the setup script to initialize your local environment
python setup_local_dev.py
```

This script will:
- Install all required dependencies
- Create a `.env.local` file from the template
- Initialize a local database (`users_local.db`)
- Set up the development environment

### 2. Configure Environment Variables

Edit the `.env.local` file and add your API keys:

```bash
# Copy the example file if it doesn't exist
cp env.local.example .env.local

# Edit the file with your API keys
notepad .env.local  # Windows
# or
nano .env.local     # Linux/Mac
```

### 3. Start Development Server

```bash
python run_local.py
```

The server will start at `http://localhost:5000` with debug mode enabled.

## 🔧 Development Workflow

### Daily Development Process

1. **Start Development Server**
   ```bash
   python run_local.py
   ```

2. **Make Changes**
   - Edit files in your code editor
   - The server will automatically reload when you save changes
   - Test your changes at `http://localhost:5000`

3. **Test Your Changes**
   - Use the local database (`users_local.db`)
   - All changes are isolated from production
   - Debug mode shows detailed error messages

4. **Commit Changes to GitHub**
   ```bash
   git add .
   git commit -m "Description of your changes"
   git push origin main
   ```

5. **Deploy to Production**
   - On PythonAnywhere console:
   ```bash
   git pull origin main
   # Reload the web app
   ```

### Database Management

- **Local Database**: `users_local.db` (for development)
- **Production Database**: `users.db` (on PythonAnywhere)

The app automatically uses the correct database based on the `LOCAL_DEV` environment variable.

### Environment Variables

| Variable | Development | Production |
|----------|-------------|------------|
| `LOCAL_DEV` | `1` | Not set |
| `FLASK_ENV` | `development` | `production` |
| `FLASK_DEBUG` | `1` | `0` |
| Database | `users_local.db` | `users.db` |

## 🛠️ Useful Commands

### Development
```bash
# Start development server
python run_local.py

# Setup environment (first time only)
python setup_local_dev.py

# Install new dependencies
pip install package_name
pip freeze > requirements.txt
```

### Git Workflow
```bash
# Check status
git status

# Add changes
git add .

# Commit changes
git commit -m "Your commit message"

# Push to GitHub
git push origin main

# Pull latest changes
git pull origin main
```

### Database Operations
```bash
# Initialize local database
python init_database.py

# Check database
python check_calendar_events.py
python check_notifications.py
```

## 🔍 Debugging

### Debug Mode Features
- **Auto-reload**: Server restarts when you save files
- **Detailed error pages**: Shows stack traces and variable values
- **Console logging**: Check terminal for debug messages

### Common Issues

1. **Port already in use**
   ```bash
   # Kill process on port 5000
   netstat -ano | findstr :5000
   taskkill /PID <PID> /F
   ```

2. **Database issues**
   ```bash
   # Reinitialize local database
   python init_database.py
   ```

3. **Missing dependencies**
   ```bash
   # Reinstall requirements
   pip install -r requirements.txt
   ```

## 📁 Project Structure

```
Links-main/
├── bodybuilding_app.py      # Main Flask application
├── run_local.py            # Local development server
├── setup_local_dev.py      # Setup script
├── requirements.txt        # Python dependencies
├── .env.local             # Local environment variables
├── env.local.example      # Environment template
├── users_local.db         # Local development database
├── users.db               # Production database
├── static/                # Static files (CSS, JS, images)
├── templates/             # HTML templates
└── LOCAL_DEVELOPMENT.md   # This guide
```

## 🚨 Important Notes

1. **Never commit `.env.local`** - It contains sensitive API keys
2. **Always test locally** before pushing to production
3. **Use different API keys** for development and production
4. **Backup your local database** if you have important test data

## 🔄 Production Deployment

When you're ready to deploy:

1. **Test thoroughly** in local environment
2. **Commit and push** to GitHub
3. **On PythonAnywhere**:
   ```bash
   git pull origin main
   # Reload the web app
   ```

The production environment will automatically use the production database and settings.

## 📞 Support

If you encounter issues:
1. Check the debug output in the terminal
2. Verify your `.env.local` configuration
3. Ensure all dependencies are installed
4. Check the database initialization

Happy coding! 🎉
