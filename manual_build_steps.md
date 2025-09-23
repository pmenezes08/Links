# Manual React Build Steps for PythonAnywhere

Since npm might not be in your PATH on PythonAnywhere, here are manual steps to rebuild your React app:

## Option 1: Try sourcing nvm

```bash
cd /home/puntz08/WorkoutX/Links

# Source nvm to get npm in PATH
source ~/.nvm/nvm.sh

# Navigate to client directory
cd client

# Install dependencies
npm install

# Build the app
npm run build
```

## Option 2: Use full npm path

```bash
cd /home/puntz08/WorkoutX/Links/client

# Use full path to npm
/home/ubuntu/.nvm/versions/node/v22.16.0/bin/npm install
/home/ubuntu/.nvm/versions/node/v22.16.0/bin/npm run build
```

## Option 3: Set up npm in PATH

```bash
# Add to your ~/.bashrc
echo 'export PATH="/home/ubuntu/.nvm/versions/node/v22.16.0/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc

# Then normal commands work
cd /home/puntz08/WorkoutX/Links/client
npm install
npm run build
```

## Verify Build Success

After building, check:

```bash
# Check if new files were created
ls -la /home/puntz08/WorkoutX/Links/client/dist/

# Check modification times
python /home/puntz08/WorkoutX/Links/check_react_routing.py
```

## After Successful Build

1. **Restart your Flask application**
2. **Clear browser cache** (Ctrl+F5 or Cmd+Shift+R)
3. **Test the user chat interface**

You should then see all the WhatsApp-style layout changes we implemented!