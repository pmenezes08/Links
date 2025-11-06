# Quick Start: MuseTalk GPU Server

## What You'll Do

1. ✅ **Deploy API server to GPU** (~20 minutes)
2. ✅ **Configure your main app** (~2 minutes)
3. ✅ **Test end-to-end** (~1 minute)

Total time: **~25 minutes** to get fast GPU-powered talking avatars!

---

## Step 1: Choose Your GPU Provider

I recommend **RunPod** for beginners (easiest setup):

### 1.1 Sign up at RunPod
- Go to https://www.runpod.io/
- Create account
- Add $10 credit (will last ~50 hours of usage)

### 1.2 Launch a GPU Pod
1. Click "Deploy" → "GPU Pods"
2. Filter:
   - GPU: RTX 3060 (12GB) or RTX 4070
   - Storage: 30GB minimum
3. Select template: **PyTorch** (has CUDA pre-installed)
4. Click "Deploy On-Demand" (~$0.30/hour)
5. Wait ~30 seconds for pod to start
6. Click "Connect" → Copy SSH command

---

## Step 2: Set Up MuseTalk on GPU Server

### 2.1 SSH into your pod

```bash
# Use the SSH command from RunPod (example):
ssh root@X.X.X.X -p 12345 -i ~/.ssh/id_ed25519
```

### 2.2 Run the automated setup

Copy this entire block and paste it into your GPU server terminal:

```bash
# Install system dependencies
apt update && apt install -y git ffmpeg

# Clone MuseTalk
cd ~
git clone https://github.com/TMElyralab/MuseTalk.git
cd MuseTalk

# Install Python dependencies
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118
pip install -r requirements.txt

# Download model weights (~2GB, takes 5-10 min)
bash scripts/download_weights.sh

# Verify GPU works
python -c "import torch; print('✅ CUDA available!' if torch.cuda.is_available() else '❌ No GPU')"
```

### 2.3 Deploy the API server

```bash
# Create API directory
mkdir -p ~/musetalk-api
cd ~/musetalk-api

# Download API server code
wget https://raw.githubusercontent.com/pmenezes08/Links/main/musetalk_api_server.py
wget https://raw.githubusercontent.com/pmenezes08/Links/main/musetalk_api_requirements.txt

# Install API dependencies
pip install -r musetalk_api_requirements.txt

# Generate secure API key
export MUSETALK_API_SECRET=$(openssl rand -hex 32)

# Create .env file
cat > .env << EOF
MUSETALK_PATH=/root/MuseTalk
OUTPUT_DIR=/root/musetalk-api/outputs
MUSETALK_API_SECRET=$MUSETALK_API_SECRET
PORT=5000
EOF

# Print your API secret (save this!)
echo ""
echo "========================================"
echo "🔑 Your API Secret (SAVE THIS!):"
echo "$MUSETALK_API_SECRET"
echo "========================================"
echo ""

# Start server in background
nohup python musetalk_api_server.py > api.log 2>&1 &

# Wait a moment for startup
sleep 3

# Check if running
if curl -s http://localhost:5000/health | grep -q "healthy"; then
    echo "✅ API server is running!"
else
    echo "❌ Server failed to start. Check: tail -f api.log"
fi
```

### 2.4 Expose API to internet

**Option A: ngrok (quick, free, easy)**

```bash
# Install ngrok
wget https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.tgz
tar xvzf ngrok-v3-stable-linux-amd64.tgz
mv ngrok /usr/local/bin/

# Sign up at https://dashboard.ngrok.com/get-started/setup
# Get your auth token and run:
ngrok config add-authtoken YOUR_NGROK_TOKEN

# Expose port 5000
ngrok http 5000
```

You'll see output like:

```
Forwarding   https://abc123xyz.ngrok.io -> http://localhost:5000
```

**Copy that https URL!** (e.g., `https://abc123xyz.ngrok.io`)

**Option B: Direct IP** (if RunPod gives you public IP)

```bash
# Just use: http://YOUR_POD_IP:5000
# Allow port in firewall:
ufw allow 5000
```

---

## Step 3: Configure Your Main App

On your **PythonAnywhere server** (your main app):

```bash
cd ~/WorkoutX/Links

# Add to .env file
cat >> .env << 'EOF'

# MuseTalk GPU API
MUSETALK_API_URL=https://YOUR_NGROK_URL_HERE
MUSETALK_API_SECRET=your-secret-from-step-2.3
EOF

# Install requests library (if not already)
pip3 install --user requests

# Test the connection
python3 -c "
import os
os.environ['MUSETALK_API_URL'] = 'YOUR_URL'
os.environ['MUSETALK_API_SECRET'] = 'YOUR_SECRET'
from musetalk_integration import check_api_health
print(check_api_health())
"
```

Expected output: `(True, 'API healthy')`

---

## Step 4: Reload Your App

```bash
# Reload Flask app
touch /var/www/puntz08_pythonanywhere_com_wsgi.py

# Or use the PythonAnywhere web interface:
# "Web" tab → "Reload" button
```

---

## Step 5: Test It!

1. Go to your app
2. Create an "Imagine" post with talking avatar
3. Upload image and audio
4. Submit!

Check logs on PythonAnywhere:

```bash
tail -f ~/WorkoutX/Links/server.log
```

You should see:

```
[MuseTalk API] Generating video: /path/to/image.jpg + /path/to/audio.wav
[MuseTalk API] Using server: https://abc123.ngrok.io
[MuseTalk API] Video generated! Job ID: abc-def-123
[MuseTalk API] Video saved: 1234567 bytes at /path/to/output.mp4
```

---

## Cost Management

### Stop GPU when not in use (save money!)

On GPU server:

```bash
# Stop API server
pkill -f musetalk_api_server.py

# Stop ngrok
pkill ngrok
```

On RunPod dashboard:
- Click "Stop" on your pod
- Restart when needed (takes 30 seconds)

### Auto-shutdown after idle

Add this to your GPU server:

```bash
# Auto-stop after 1 hour of no requests
cat > ~/auto_shutdown.sh << 'EOF'
#!/bin/bash
while true; do
    LAST_REQUEST=$(stat -c %Y /root/musetalk-api/outputs/.last_request 2>/dev/null || echo 0)
    NOW=$(date +%s)
    IDLE=$((NOW - LAST_REQUEST))
    
    if [ $IDLE -gt 3600 ]; then
        echo "Idle for 1 hour, shutting down..."
        shutdown -h now
    fi
    
    sleep 300  # Check every 5 minutes
done
EOF
chmod +x ~/auto_shutdown.sh
nohup ~/auto_shutdown.sh &
EOF
```

### Estimated Costs

- **Development** (stop when not testing): $0.30/hour × ~2 hours/day = **$0.60/day**
- **Production** (24/7 uptime): $0.30/hour × 24 = **$7.20/day**
- **Smart** (auto-shutdown): $0.30/hour × ~4 hours/day = **$1.20/day**

For comparison:
- **D-ID API**: $0.10-0.30 per video
- **Your GPU**: $0.01-0.02 per video (much cheaper at scale!)

---

## Troubleshooting

### GPU not detected

```bash
nvidia-smi  # Should show GPU
python -c "import torch; print(torch.cuda.is_available())"  # Should be True
```

### API not accessible from main app

```bash
# On GPU server:
curl http://localhost:5000/health  # Should work locally

# From main app:
curl https://YOUR_NGROK_URL/health  # Should work remotely
```

### Video generation fails

Check GPU server logs:

```bash
cd ~/musetalk-api
tail -f api.log
```

Common issues:
- Out of GPU memory → Reduce batch_size in `musetalk_api_server.py` (line 93)
- Model files missing → Re-run `bash scripts/download_weights.sh`

### ngrok disconnects

Free ngrok sessions expire after 8 hours. Options:
1. Reconnect when needed: `ngrok http 5000`
2. Upgrade to ngrok paid ($8/month) for persistent URLs
3. Use RunPod's public IP instead

---

## Next Steps

1. ✅ **Monitor usage** - Check RunPod dashboard for costs
2. ✅ **Optimize** - Implement auto-shutdown to save money
3. ✅ **Scale** - If popular, keep GPU running 24/7
4. ✅ **Upgrade** - Switch to faster GPU (RTX 4090) for 2-3x speed

---

## Summary

✅ Your main app now calls a **fast GPU server** for talking avatars  
✅ Generation time: **10-30 seconds** (was timing out before)  
✅ Cost: **~$1-7/day** (vs $0 local but broken)  
✅ Scalable: Add more GPU servers as needed  

**You're now running AI at scale! 🚀**
