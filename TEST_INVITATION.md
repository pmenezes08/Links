# Test Invitation System

## Step 1: Verify You Have Latest Code

On your PythonAnywhere server:

```bash
cd ~/dev/Links
git pull origin develop
git log --oneline -1
```

You should see: `c315f3e8 Allow re-invitation after user deletion`

## Step 2: Reload Webapp

1. Go to PythonAnywhere Web tab
2. Click **"Reload [your-app].pythonanywhere.com"** button
3. Wait for it to finish

## Step 3: Test Invitation Verification API

Run this on your server to test the verification endpoint:

```bash
cd ~/dev/Links
python3 << 'EOF'
import requests

# Replace with your actual invitation token from the email
TOKEN = "YOUR_INVITATION_TOKEN_HERE"

response = requests.get(f"https://your-app.pythonanywhere.com/api/invitation/verify?token={TOKEN}")
print(f"Status: {response.status_code}")
print(f"Response: {response.json()}")
EOF
```

**Expected output:**
```json
{
  "success": true,
  "email": "test@example.com",
  "community_name": "Your Community",
  "invited_by": "admin"
}
```

## Step 4: Check React Build

Verify the React app is using the latest build:

```bash
cd ~/dev/Links/client/dist
ls -lah index.html assets/*.js | head -5
```

The files should have today's timestamp.

## Step 5: Clear Browser Cache

**Important!** Your browser might be caching the old React code:

1. Open the signup page: `https://www.c-point.co/signup?invite=TOKEN`
2. Press **Ctrl+Shift+R** (Windows/Linux) or **Cmd+Shift+R** (Mac) to hard refresh
3. Or open in **Incognito/Private mode**

## What Should Happen:

When you open: `https://www.c-point.co/signup?invite=YOUR_TOKEN`

1. ✅ You should see a blue box at the top:
   - "You've been invited to join [Community Name]"
   - "by [username]"

2. ✅ The email field should be:
   - Pre-filled with the invited email
   - Greyed out (can't change it)
   - Shows message: "Email is pre-filled from your invitation"

3. ✅ After signup:
   - No email verification needed
   - Logs in automatically
   - Goes directly to dashboard (skips onboarding)
   - Community is already joined

## Still Not Working?

Check browser console (F12 → Console tab) for errors when you load the signup page.

Look for:
- Network errors calling `/api/invitation/verify`
- JavaScript errors
- Failed fetch requests
