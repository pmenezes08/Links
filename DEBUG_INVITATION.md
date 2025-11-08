# Debug Invitation System - Step by Step

## Run These Commands on Your Server

### Step 1: Pull Latest Code
```bash
cd ~/dev/Links
git pull origin develop
```

### Step 2: Check if Table Exists
```bash
cd ~/dev/Links
python3 test_invitation_api.py
```

**If it says table doesn't exist:**
- Go to PythonAnywhere Web tab
- Click "Reload" button
- Wait 10 seconds
- Run the script again

### Step 3: Send a Test Invitation

1. Go to your Admin Dashboard on the website
2. Click "Invite" on any community
3. Enter your own email (one you can check)
4. Click "Send Invite"

### Step 4: Get the Token

After running the test script again:
```bash
python3 test_invitation_api.py
```

Copy the full token from the output.

### Step 5: Test the API Endpoint Directly

Replace `YOUR_TOKEN_HERE` with the actual token:

```bash
curl "https://www.c-point.co/api/invitation/verify?token=YOUR_TOKEN_HERE"
```

**Expected output:**
```json
{"success":true,"email":"your@email.com","community_name":"Your Community","invited_by":"username"}
```

**If you get an error or "Invalid invitation":**
- The table might not exist yet
- Reload your webapp again

### Step 6: Test the Signup Page

Open this URL in your browser (replace TOKEN):
```
https://www.c-point.co/signup?invite=YOUR_TOKEN_HERE
```

**Open Browser DevTools (F12):**
1. Go to "Console" tab
2. Look for any errors in red
3. Go to "Network" tab
4. Refresh the page (Ctrl+R)
5. Look for a request to `/api/invitation/verify`
6. Click on it and check the response

### Step 7: Common Issues

**Issue 1: Table doesn't exist**
- Solution: Reload webapp, wait 30 seconds, try again

**Issue 2: API returns 404**
- Check if you're on the correct URL (www.c-point.co)
- Check if webapp is fully loaded

**Issue 3: Email not pre-filled**
- Check browser console for JavaScript errors
- Make sure the URL has `?invite=TOKEN` in it
- Make sure token is valid (not used, not expired)

**Issue 4: Verification still required**
- This means the backend didn't receive the invite_token
- Check if FormData includes `invite_token` in Network tab
- Look at the `/signup` POST request in Network tab

## Report Back

Send me:
1. Output of `python3 test_invitation_api.py`
2. Result of the curl command
3. Any errors from browser console
4. Screenshot of the Network tab showing the `/api/invitation/verify` request
