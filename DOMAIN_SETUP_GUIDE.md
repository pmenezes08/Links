# GoDaddy Domain → PythonAnywhere Setup Guide

## ⚠️ Important Prerequisites
- **You MUST have a PAID PythonAnywhere account** (Hacker plan or higher)
- Free accounts do NOT support custom domains

## 📋 Quick Checklist

### Step 1: PythonAnywhere Side
- [ ] Log into PythonAnywhere
- [ ] Go to "Web" tab
- [ ] Add your domain in the custom domain section
- [ ] Copy the CNAME target (e.g., `yourusername.pythonanywhere.com`)
- [ ] Note: Domain should be without http:// (just `yourdomain.com` or `www.yourdomain.com`)

### Step 2: GoDaddy DNS Settings
- [ ] Log into GoDaddy
- [ ] Go to "My Products" → Your Domain → "DNS" or "Manage DNS"
- [ ] Add CNAME Record:
  - Type: `CNAME`
  - Name: `www`
  - Value: `[your-pythonanywhere-username].pythonanywhere.com`
  - TTL: 1 hour
- [ ] Delete any A records for `www` (if they exist)
- [ ] Set up Domain Forwarding:
  - From: `yourdomain.com`
  - To: `https://www.yourdomain.com`
  - Type: 301 (Permanent)
  - Forward with masking: Yes (if available)

### Step 3: Wait for DNS Propagation
- [ ] DNS changes can take 1-48 hours to propagate
- [ ] Usually works within 1-4 hours

### Step 4: SSL Certificate (HTTPS)
- [ ] Go back to PythonAnywhere "Web" tab
- [ ] Find "HTTPS certificate" section
- [ ] Click "Fetch certificate"
- [ ] Wait for certificate generation (few minutes)

### Step 5: Update PythonAnywhere Web App
- [ ] In PythonAnywhere "Web" tab
- [ ] Make sure your web app is running
- [ ] Click "Reload" button to apply all changes

### Step 6: Test Your Domain
- [ ] Try accessing: `https://www.yourdomain.com`
- [ ] Verify SSL certificate is working (padlock icon)
- [ ] Check that `yourdomain.com` redirects to `www.yourdomain.com`

## 🔧 Troubleshooting

### Domain Not Working After 24 Hours?
1. Check DNS propagation: https://www.whatsmydns.net/
2. Verify CNAME record in GoDaddy DNS
3. Ensure no conflicting A records for www
4. Check PythonAnywhere error log

### SSL Certificate Issues?
1. Wait 10 minutes after DNS setup before fetching certificate
2. Make sure domain is properly pointed to PythonAnywhere
3. Try "Force HTTPS" option in PythonAnywhere

### Getting 404 or App Not Loading?
1. Reload your web app in PythonAnywhere
2. Check error log in PythonAnywhere
3. Verify your app is using the correct WSGI configuration

## 📝 Your Specific Setup Information

Fill this in as you go:
- PythonAnywhere Username: `_____________`
- Domain Name: `_____________`
- CNAME Target: `_____________.pythonanywhere.com`
- Date/Time DNS Changed: `_____________`
- SSL Certificate Fetched: `_____________`

## 🚀 Final Steps

Once everything is working:
1. Update any hardcoded URLs in your app to use the new domain
2. Update OAuth redirect URLs (if using social login)
3. Update any API webhooks
4. Set up domain email if needed (through GoDaddy)

## 📧 Need Help?

- PythonAnywhere Help: https://help.pythonanywhere.com/pages/CustomDomains/
- GoDaddy DNS Help: https://www.godaddy.com/help/manage-dns-records-680
- DNS Propagation Checker: https://www.whatsmydns.net/