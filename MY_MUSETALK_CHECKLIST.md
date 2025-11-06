# My MuseTalk GPU Setup Checklist

Use this checklist as you set up your GPU server. Check off each step as you complete it!

## 🎯 Goal
Get talking avatar videos working in ~25 minutes using a remote GPU server.

---

## ☑️ Pre-Setup (5 minutes)

- [ ] Read `QUICK_START_MUSETALK_GPU.md` (quick overview)
- [ ] Or read `MUSETALK_GPU_SETUP.md` (detailed version)
- [ ] Choose GPU provider: **RunPod** (recommended) or Vast.ai
- [ ] Create account and add $10 credit

---

## ☑️ Part 1: GPU Server Setup (15 minutes)

### Launch GPU

- [ ] Go to RunPod.io → "Deploy" → "GPU Pods"
- [ ] Select: **RTX 3060** or **RTX 4070** (12GB+ VRAM)
- [ ] Template: **PyTorch** (has CUDA)
- [ ] Storage: **30GB minimum**
- [ ] Click "Deploy On-Demand"
- [ ] Wait ~30 seconds for pod to start
- [ ] Click "Connect" → Copy SSH command

### Install MuseTalk

```bash
# Paste these commands one by one into your GPU server terminal:

# 1. Install system deps
apt update && apt install -y git ffmpeg

# 2. Clone MuseTalk
cd ~
git clone https://github.com/TMElyralab/MuseTalk.git
cd MuseTalk

# 3. Install Python deps
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118
pip install -r requirements.txt

# 4. Download models (~5-10 min)
bash scripts/download_weights.sh

# 5. Verify GPU
python -c "import torch; print('✅ CUDA!' if torch.cuda.is_available() else '❌ No GPU')"
```

- [ ] All commands completed successfully
- [ ] GPU verification shows "✅ CUDA!"

### Deploy API Server

```bash
# 1. Create API directory
mkdir -p ~/musetalk-api
cd ~/musetalk-api

# 2. Download files
wget https://raw.githubusercontent.com/pmenezes08/Links/main/musetalk_api_server.py
wget https://raw.githubusercontent.com/pmenezes08/Links/main/musetalk_api_requirements.txt

# 3. Install dependencies
pip install -r musetalk_api_requirements.txt

# 4. Generate secure API key
export MUSETALK_API_SECRET=$(openssl rand -hex 32)

# 5. Create config
cat > .env << EOF
MUSETALK_PATH=/root/MuseTalk
OUTPUT_DIR=/root/musetalk-api/outputs
MUSETALK_API_SECRET=$MUSETALK_API_SECRET
PORT=5000
EOF

# 6. Print API secret (SAVE THIS!)
echo ""
echo "========================================"
echo "🔑 Your API Secret:"
echo "$MUSETALK_API_SECRET"
echo "========================================"
echo ""

# 7. Start server
nohup python musetalk_api_server.py > api.log 2>&1 &

# 8. Test server (wait 3 seconds first)
sleep 3
curl -s http://localhost:5000/health
```

- [ ] Server started successfully
- [ ] `/health` endpoint returns `{"status": "healthy"}`
- [ ] **API secret saved** (you'll need this!)

### Expose to Internet

**Using ngrok:**

```bash
# 1. Install ngrok
wget https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.tgz
tar xvzf ngrok-v3-stable-linux-amd64.tgz
mv ngrok /usr/local/bin/

# 2. Sign up at https://dashboard.ngrok.com/get-started/setup
# 3. Get your auth token from ngrok dashboard
# 4. Run:
ngrok config add-authtoken YOUR_NGROK_TOKEN_HERE

# 5. Expose API
ngrok http 5000
```

- [ ] ngrok running
- [ ] **ngrok URL saved** (e.g., `https://abc123.ngrok.io`)

---

## ☑️ Part 2: Configure Main App (3 minutes)

### On PythonAnywhere Server

```bash
# 1. Pull latest code
cd ~/WorkoutX/Links
git pull origin main

# 2. Add API config to .env
nano .env  # Or use editor
```

**Add these lines to `.env`:**

```bash
# MuseTalk GPU API
MUSETALK_API_URL=https://YOUR_NGROK_URL_HERE
MUSETALK_API_SECRET=your-api-secret-from-above
```

- [ ] `.env` updated with correct URL
- [ ] `.env` updated with correct API secret

### Test Connection

```bash
python3 << 'EOF'
import os

# Replace with your actual values
os.environ['MUSETALK_API_URL'] = 'https://YOUR_URL'
os.environ['MUSETALK_API_SECRET'] = 'YOUR_SECRET'

from musetalk_integration import check_api_health
healthy, message = check_api_health()
print(f"{'✅' if healthy else '❌'} {message}")
EOF
```

- [ ] Test shows: `✅ API healthy`

### Reload App

```bash
# Option 1: Touch WSGI file
touch /var/www/puntz08_pythonanywhere_com_wsgi.py

# Option 2: Use PythonAnywhere web interface
# Go to "Web" tab → Click "Reload" button
```

- [ ] App reloaded

---

## ☑️ Part 3: Test End-to-End (2 minutes)

1. Go to your app in browser
2. Create new "Imagine" post
3. Enable "Talking Avatar"
4. Upload test image and audio
5. Submit and wait

**Check logs:**

```bash
tail -f ~/WorkoutX/Links/server.log
```

**Expected output:**

```
[MuseTalk API] Generating video: ...
[MuseTalk API] Using server: https://abc123.ngrok.io
[MuseTalk API] Video generated! Job ID: ...
[MuseTalk API] Video saved: 1234567 bytes
```

- [ ] Video generated successfully
- [ ] Video plays in app
- [ ] Generation took < 30 seconds

---

## ✅ Success Checklist

- [ ] GPU server running MuseTalk API
- [ ] API accessible via ngrok URL
- [ ] Main app configured with API URL and secret
- [ ] End-to-end test successful
- [ ] Video generation working

---

## 📝 Save These for Later

**My GPU Server Details:**

```
GPU Provider: RunPod / Vast.ai (circle one)
Pod ID: ___________________________
SSH Command: ___________________________
```

**My API Configuration:**

```
ngrok URL: https://________________________________
API Secret: ________________________________
```

**Important Commands:**

```bash
# Restart API server (if needed)
ssh into GPU server
cd ~/musetalk-api
pkill -f musetalk_api_server.py
nohup python musetalk_api_server.py > api.log 2>&1 &

# Restart ngrok (if disconnected)
ngrok http 5000

# Check GPU server logs
tail -f ~/musetalk-api/api.log

# Stop GPU server (save money!)
# On RunPod dashboard: Click "Stop" on your pod
```

---

## 💰 Cost Management

- [ ] Understand costs: ~$0.30/hour = $7.20/day if running 24/7
- [ ] **Stop GPU when not testing** (saves ~$5/day)
- [ ] Consider auto-shutdown script (in `QUICK_START_MUSETALK_GPU.md`)

---

## 🆘 Troubleshooting

**Video generation still fails?**

1. Check GPU server logs: `tail -f ~/musetalk-api/api.log`
2. Check main app logs: `tail -f ~/WorkoutX/Links/server.log`
3. Test API directly:
   ```bash
   curl -X POST https://YOUR_URL/generate \
     -H "Authorization: Bearer YOUR_SECRET" \
     -F "image=@test.jpg" \
     -F "audio=@test.wav"
   ```

**ngrok disconnected?**

- Free tier disconnects after 8 hours
- Just restart: `ngrok http 5000`
- Or upgrade to ngrok paid ($8/month)

**Out of GPU memory?**

- Edit `musetalk_api_server.py` line 93
- Change `'--batch_size', '4'` to `'--batch_size', '1'`
- Restart API server

---

## 🎉 Next Steps

Once working:

1. ✅ Monitor RunPod costs daily
2. ✅ Stop GPU when not needed
3. ✅ If popular, keep running 24/7
4. ✅ Upgrade to faster GPU (RTX 4090) for 3x speed

---

**You've got this! 🚀**
