#!/usr/bin/env python3
"""
Test what happens when Mary tries to create a sub-community
Run with the exact same parameters Mary would use
"""

import requests

# Test on your domain
BASE_URL = "https://puntz08.pythonanywhere.com"

# You'll need to login as Mary first and get her session cookie
# Or run this from browser console:

print("""
Run this in your browser console while logged in as Mary:

fetch('/create_community', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  credentials: 'include',
  body: new URLSearchParams({
    name: 'Test Sub-Community',
    type: 'Business',
    parent_community_id: 'ACME_PARENT_ID_HERE'  // Replace with actual ACME Corp ID
  })
})
.then(r => r.json())
.then(j => console.log('Response:', j))
.catch(e => console.error('Error:', e))

This will show you the exact error Mary is getting.
""")
