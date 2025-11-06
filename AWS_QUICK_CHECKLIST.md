# AWS EC2 MuseTalk Setup Checklist

Quick checklist for setting up MuseTalk on AWS EC2 g5.xlarge spot instance.

**Time Required**: 30-45 minutes
**Cost**: ~$0.40-0.60/hour

---

## ☑️ Pre-Setup (5 minutes)

- [ ] AWS account created
- [ ] Payment method added
- [ ] Billing alerts configured ($50-100/month)
- [ ] Read `AWS_EC2_MUSETALK_SETUP.md` overview

---

## ☑️ Launch EC2 Instance (10 minutes)

### AWS Console Setup

- [ ] Go to EC2 Console
- [ ] Click "Launch Instance"
- [ ] **Name**: `musetalk-gpu-server`
- [ ] **AMI**: Ubuntu Server 22.04 LTS
- [ ] **Instance Type**: g5.xlarge (4 vCPU, 16GB RAM, A10G GPU)
- [ ] **Key Pair**: Create new → Download `musetalk-key.pem` (SAVE THIS!)
- [ ] **Security Group**: Create new
  - SSH (22): My IP or Anywhere
  - Custom TCP (5000): Anywhere
- [ ] **Storage**: 50 GB gp3
- [ ] **Advanced → Purchasing option**: ☑️ Request Spot Instances
- [ ] Click "Launch Instance"
- [ ] Wait for "Running" status
- [ ] **Copy Public IPv4 address**: `_________________`

---

## ☑️ Connect to Instance (3 minutes)

```bash
# Set key permissions
chmod 400 ~/Downloads/musetalk-key.pem

# Connect
ssh -i ~/Downloads/musetalk-key.pem ubuntu@YOUR_EC2_IP
```

- [ ] Successfully connected to EC2 instance

---

## ☑️ Install NVIDIA Drivers (10 minutes)

```bash
# Run these commands on EC2 instance:

# Update system
sudo apt update && sudo apt upgrade -y

# Install NVIDIA drivers
sudo apt install -y ubuntu-drivers-common
sudo ubuntu-drivers autoinstall

# Install CUDA
wget https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2204/x86_64/cuda-keyring_1.0-1_all.deb
sudo dpkg -i cuda-keyring_1.0-1_all.deb
sudo apt update
sudo apt install -y cuda-toolkit-11-8

# Add to PATH
echo 'export PATH=/usr/local/cuda-11.8/bin:$PATH' >> ~/.bashrc
echo 'export LD_LIBRARY_PATH=/usr/local/cuda-11.8/lib64:$LD_LIBRARY_PATH' >> ~/.bashrc
source ~/.bashrc

# REBOOT
sudo reboot
```

- [ ] Commands completed
- [ ] Rebooted (wait 1 minute)
- [ ] Reconnected: `ssh -i ~/Downloads/musetalk-key.pem ubuntu@YOUR_EC2_IP`
- [ ] Verified GPU: `nvidia-smi` shows NVIDIA A10G

---

## ☑️ Install MuseTalk (15 minutes)

```bash
# Install dependencies
sudo apt install -y python3 python3-pip git ffmpeg

# Clone MuseTalk
cd ~
git clone https://github.com/TMElyralab/MuseTalk.git
cd MuseTalk

# Install PyTorch with CUDA
pip3 install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118

# Install MuseTalk requirements
pip3 install -r requirements.txt

# Download model weights (~5-10 min, 2GB)
bash scripts/download_weights.sh

# Verify
python3 -c "import torch; print('✅ CUDA available!' if torch.cuda.is_available() else '❌ No GPU')"
```

- [ ] All commands completed
- [ ] Verification shows: `✅ CUDA available!`

---

## ☑️ Deploy API Server (5 minutes)

```bash
# Create API directory
mkdir -p ~/musetalk-api
cd ~/musetalk-api

# Download files
wget https://raw.githubusercontent.com/pmenezes08/Links/main/musetalk_api_server.py
wget https://raw.githubusercontent.com/pmenezes08/Links/main/musetalk_api_requirements.txt

# Install dependencies
pip3 install -r musetalk_api_requirements.txt

# Generate API secret
export MUSETALK_API_SECRET=$(openssl rand -hex 32)

# Create config
cat > .env << EOF
MUSETALK_PATH=/home/ubuntu/MuseTalk
OUTPUT_DIR=/home/ubuntu/musetalk-api/outputs
MUSETALK_API_SECRET=$MUSETALK_API_SECRET
PORT=5000
EOF

# Display API secret (SAVE THIS!)
echo ""
echo "========================================"
echo "🔑 YOUR API SECRET:"
echo "$MUSETALK_API_SECRET"
echo "========================================"

# Start server
nohup python3 musetalk_api_server.py > api.log 2>&1 &

# Wait and test
sleep 3
curl http://localhost:5000/health
```

- [ ] Server started
- [ ] Health check returns `{"status": "healthy"}`
- [ ] **API Secret saved**: `_______________________________`

---

## ☑️ Configure Main App (5 minutes)

### On PythonAnywhere:

```bash
cd ~/WorkoutX/Links

# Edit .env
nano .env
```

**Add these lines:**

```bash
# MuseTalk AWS API
MUSETALK_API_URL=http://YOUR_EC2_PUBLIC_IP:5000
MUSETALK_API_SECRET=your-secret-from-above
```

- [ ] `.env` updated with EC2 IP
- [ ] `.env` updated with API secret
- [ ] Saved and closed

### Test Connection

```bash
python3 << 'EOF'
import os
os.environ['MUSETALK_API_URL'] = 'http://YOUR_EC2_IP:5000'
os.environ['MUSETALK_API_SECRET'] = 'YOUR_SECRET'

from musetalk_integration import check_api_health
healthy, message = check_api_health()
print(f"{'✅' if healthy else '❌'} {message}")
EOF
```

- [ ] Test shows: `✅ API healthy`

### Reload App

```bash
touch /var/www/puntz08_pythonanywhere_com_wsgi.py
```

- [ ] App reloaded

---

## ☑️ Test End-to-End (3 minutes)

1. Go to your app
2. Create "Imagine" post with talking avatar
3. Upload image and audio
4. Submit

**Check logs:**

```bash
# On PythonAnywhere:
tail -f ~/WorkoutX/Links/server.log

# On EC2:
tail -f ~/musetalk-api/api.log
```

- [ ] Video generated successfully
- [ ] Generation took < 30 seconds
- [ ] Video plays in app

---

## ☑️ Optional: Set Up Auto-Shutdown (3 minutes)

### On EC2 instance:

```bash
cd ~
cat > auto_shutdown.sh << 'EOF'
#!/bin/bash
while true; do
    RECENT=$(find /home/ubuntu/musetalk-api/outputs -type f -mmin -120 2>/dev/null | wc -l)
    if [ "$RECENT" -eq 0 ]; then
        echo "$(date): No activity for 2 hours. Shutting down..."
        sudo shutdown -h now
    fi
    sleep 600
done
EOF

chmod +x auto_shutdown.sh
nohup ./auto_shutdown.sh > auto_shutdown.log 2>&1 &
```

- [ ] Auto-shutdown script running
- [ ] Will shut down after 2 hours of inactivity

---

## ☑️ Optional: Create Elastic IP (5 minutes)

### In AWS Console:

1. EC2 → Elastic IPs
2. "Allocate Elastic IP address"
3. "Associate Elastic IP address"
4. Select your instance
5. Update `.env` with new permanent IP

- [ ] Elastic IP created
- [ ] Associated with instance
- [ ] `.env` updated
- [ ] App reloaded

**Benefit**: IP won't change if instance restarts!

---

## ✅ Success Checklist

- [ ] EC2 g5.xlarge spot instance running
- [ ] NVIDIA A10G GPU working
- [ ] MuseTalk API server running
- [ ] Main app configured with API URL
- [ ] End-to-end test successful
- [ ] Auto-shutdown configured (optional)
- [ ] Elastic IP configured (optional)

---

## 📝 Save These Details

**EC2 Instance Info:**

```
Instance ID: i-_________________________
Public IP: ____________________ (or Elastic IP)
Key File: ~/Downloads/musetalk-key.pem
SSH Command: ssh -i ~/Downloads/musetalk-key.pem ubuntu@YOUR_IP
```

**API Configuration:**

```
API URL: http://YOUR_EC2_IP:5000
API Secret: ________________________________
```

**Important Commands:**

```bash
# Connect to EC2
ssh -i ~/Downloads/musetalk-key.pem ubuntu@YOUR_EC2_IP

# Check API logs
tail -f ~/musetalk-api/api.log

# Check GPU
nvidia-smi

# Restart API
pkill -f musetalk_api_server && ./start_musetalk.sh

# Stop instance (from AWS Console)
EC2 → Instances → Select → Instance State → Stop
```

---

## 💰 Cost Tracking

**Expected Costs:**

- **Spot Instance**: ~$0.50/hour
- **Storage (50GB)**: ~$5/month
- **Elastic IP** (if used): $0/month (while attached)

**Monthly Estimates:**

- 24/7 uptime: ~$365/month
- 8 hours/day: ~$120/month
- 4 hours/day (with auto-shutdown): ~$60/month

**Monitor costs:** AWS Console → Billing Dashboard

---

## 🆘 Troubleshooting

**Can't connect via SSH:**
- Check security group allows SSH (port 22)
- Check key file permissions: `chmod 400 musetalk-key.pem`
- Try from different network (some block port 22)

**GPU not detected:**
- Verify instance type is g5.xlarge
- Run: `sudo ubuntu-drivers autoinstall && sudo reboot`
- Check: `nvidia-smi`

**API not accessible:**
- Check security group allows port 5000
- Check API is running: `ps aux | grep musetalk_api_server`
- Test locally on EC2: `curl http://localhost:5000/health`

**Spot instance terminated:**
- Check AWS Console for reason
- Launch new instance (same config)
- Update `.env` with new IP (if not using Elastic IP)

---

## 🎉 You're Done!

✅ AWS EC2 g5.xlarge running MuseTalk
✅ Fast GPU-powered talking avatars (10-30s)
✅ Scalable cloud infrastructure
✅ Cost-effective with spot pricing

**Enjoy your AI-powered app! 🚀**
