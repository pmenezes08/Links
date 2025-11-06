# MuseTalk GPU Server Setup Guide

This guide helps you deploy MuseTalk on a separate GPU server and connect it to your main app.

## Step 1: Choose a GPU Server Provider

### Recommended Options:

**RunPod** (Easiest)
- Cost: ~$0.20-0.40/hour
- GPU: RTX 3060 or better
- Website: https://www.runpod.io/

**Vast.ai** (Cheapest)
- Cost: ~$0.15-0.30/hour
- GPU: RTX 3060 or better
- Website: https://vast.ai/

**Paperspace Gradient** (Good for beginners)
- Cost: ~$0.50/hour
- Website: https://www.paperspace.com/

## Step 2: Set Up GPU Server

### On RunPod/Vast.ai:

1. Create account and add payment method
2. Select a GPU instance:
   - GPU: RTX 3060 (12GB) or better
   - Disk: 30GB minimum
   - Template: PyTorch or Ubuntu + CUDA

3. SSH into your instance

### On the GPU server, run:

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Python and dependencies
sudo apt install -y python3 python3-pip git ffmpeg

# Clone MuseTalk
cd ~
git clone https://github.com/TMElyralab/MuseTalk.git
cd MuseTalk

# Install dependencies
pip3 install --user torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118
pip3 install --user -r requirements.txt

# Download model weights (takes ~10 minutes, ~2GB)
bash scripts/download_weights.sh

# Verify GPU is available
python3 -c "import torch; print('CUDA available:', torch.cuda.is_available())"
```

## Step 3: Deploy MuseTalk API Server

```bash
# Create working directory
mkdir -p ~/musetalk-api
cd ~/musetalk-api

# Download the API server code (from your main repo)
wget https://raw.githubusercontent.com/pmenezes08/Links/main/musetalk_api_server.py
wget https://raw.githubusercontent.com/pmenezes08/Links/main/musetalk_api_requirements.txt

# Install API server dependencies
pip3 install --user -r musetalk_api_requirements.txt

# Set environment variables
export MUSETALK_PATH="$HOME/MuseTalk"
export OUTPUT_DIR="$HOME/musetalk-api/outputs"
export MUSETALK_API_SECRET="$(openssl rand -hex 32)"  # Generate secure secret

# Save these to a file for persistence
cat > .env << EOF
MUSETALK_PATH=$HOME/MuseTalk
OUTPUT_DIR=$HOME/musetalk-api/outputs
MUSETALK_API_SECRET=$(echo $MUSETALK_API_SECRET)
PORT=5000
EOF

echo "Save this API secret somewhere safe:"
echo "MUSETALK_API_SECRET=$MUSETALK_API_SECRET"

# Test the server
python3 musetalk_api_server.py
```

## Step 4: Run as Background Service

### Option A: Using screen (simple)

```bash
cd ~/musetalk-api
screen -S musetalk-api
source .env
export $(cat .env | xargs)
python3 musetalk_api_server.py

# Press Ctrl+A, then D to detach
# To reattach: screen -r musetalk-api
```

### Option B: Using systemd (production)

```bash
# Create service file
sudo nano /etc/systemd/system/musetalk-api.service
```

Add this content:

```ini
[Unit]
Description=MuseTalk API Server
After=network.target

[Service]
Type=simple
User=YOUR_USERNAME
WorkingDirectory=/home/YOUR_USERNAME/musetalk-api
EnvironmentFile=/home/YOUR_USERNAME/musetalk-api/.env
ExecStart=/usr/bin/python3 /home/YOUR_USERNAME/musetalk-api/musetalk_api_server.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable musetalk-api
sudo systemctl start musetalk-api
sudo systemctl status musetalk-api

# View logs
sudo journalctl -u musetalk-api -f
```

## Step 5: Expose API to Internet

### Option A: Using ngrok (quick testing)

```bash
# Install ngrok
wget https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.tgz
tar xvzf ngrok-v3-stable-linux-amd64.tgz
sudo mv ngrok /usr/local/bin/

# Sign up at https://dashboard.ngrok.com/get-started/setup
# Get your auth token and run:
ngrok config add-authtoken YOUR_AUTH_TOKEN

# Expose port 5000
ngrok http 5000

# Copy the https URL (e.g., https://abc123.ngrok.io)
```

### Option B: Using direct IP (if server has public IP)

```bash
# Just use: http://YOUR_SERVER_IP:5000
# Make sure firewall allows port 5000:
sudo ufw allow 5000
```

## Step 6: Test the API

```bash
# From any machine, test the API:
curl -X POST https://YOUR_MUSETALK_URL/generate \
  -H "Authorization: Bearer YOUR_API_SECRET" \
  -F "image=@test_image.jpg" \
  -F "audio=@test_audio.wav"

# Should return:
# {"success": true, "job_id": "abc-123", "video_url": "/download/abc-123"}

# Download the video:
curl -H "Authorization: Bearer YOUR_API_SECRET" \
  https://YOUR_MUSETALK_URL/download/abc-123 \
  -o output.mp4
```

## Step 7: Configure Your Main App

In your main app's environment (~/WorkoutX/Links/.env), add:

```bash
MUSETALK_API_URL=https://YOUR_MUSETALK_URL
MUSETALK_API_SECRET=your-secret-from-step-3
```

Then update your main app code (I'll do this automatically).

## Cost Estimation

- **RunPod**: ~$0.20/hour × 24 hours = $4.80/day (if running 24/7)
- **Vast.ai**: ~$0.15/hour × 24 hours = $3.60/day

**Cost Saving Tips:**
1. **Stop when not in use** - Only run when generating videos
2. **Spot instances** - Use interruptible instances (50% cheaper)
3. **Auto-shutdown** - Configure to shutdown after 1 hour of inactivity

## Monitoring

```bash
# Check GPU usage
nvidia-smi

# Check API logs
tail -f ~/musetalk-api/outputs/*.log

# Check disk usage
df -h
```

## Troubleshooting

**GPU not detected:**
```bash
nvidia-smi  # Should show GPU info
python3 -c "import torch; print(torch.cuda.is_available())"
```

**Out of memory on GPU:**
- Reduce batch_size to 1
- Ensure --use_float16 is set

**API not accessible:**
- Check firewall: `sudo ufw status`
- Check server is running: `ps aux | grep musetalk_api_server`
- Check port: `netstat -tlnp | grep 5000`
