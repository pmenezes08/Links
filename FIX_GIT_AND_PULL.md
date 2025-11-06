# Quick Fix: Leave venv and Pull Latest Code

## Step 1: Leave the Virtual Environment

```bash
deactivate
```

That's it! Your prompt should change from `(musetalk_env)` to just your normal prompt.

## Step 2: Handle Git Changes

You have unstaged changes. Let's save them temporarily:

```bash
cd ~/WorkoutX/Links

# Save your current changes
git stash

# Now pull the latest code
git pull origin main

# (Optional) Restore your changes if needed
# git stash pop
```

## Step 3: View the AWS Guide

```bash
cat START_HERE_AWS.txt
```

## All Commands in One Block

```bash
# Leave venv
deactivate

# Go to directory
cd ~/WorkoutX/Links

# Stash changes
git stash

# Pull latest
git pull origin main

# View guide
cat START_HERE_AWS.txt
```

That's it! You'll now have all the AWS setup files.
