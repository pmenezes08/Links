# MuseTalk on AWS EC2 g5.xlarge (Spot Instance)

Complete guide to deploy MuseTalk on AWS EC2 with GPU acceleration using spot instances for cost savings.

## Why AWS EC2 g5.xlarge?

- **GPU**: NVIDIA A10G (24GB VRAM) - excellent for AI workloads
- **Spot Price**: ~$0.40-0.60/hour (vs $1.00+ on-demand)
- **Performance**: 2-3x faster than RTX 3060
- **Reliability**: AWS infrastructure with 99.99% uptime
- **Scalability**: Easy to upgrade or add more instances

---

## Cost Breakdown

### Pricing
- **On-Demand**: ~$1.006/hour
- **Spot**: ~$0.40-0.60/hour (60% savings!)
- **Storage**: ~$0.10/GB/month for EBS

### Monthly Cost Estimates
- **Development** (8 hours/day): ~$72-108/month
- **Production** (24/7): ~$288-432/month
- **Smart Auto-Shutdown** (4 hours/day): ~$36-54/month

**Per Video Cost**: ~$0.001-0.003 (10-30 seconds generation time)

---

## Step 1: AWS Account Setup

### 1.1 Create AWS Account (if needed)
1. Go to https://aws.amazon.com/
2. Click "Create an AWS Account"
3. Follow signup process
4. **Add payment method** (required)
5. **Verify identity** (phone verification)

### 1.2 Set Billing Alerts
1. Go to AWS Console → Billing Dashboard
2. Click "Budgets" → "Create budget"
3. Set budget to $50-100/month
4. Add email alerts at 80% and 100%

### 1.3 Request Spot Instance Limit Increase (if needed)
1. Go to Service Quotas
2. Search "EC2"
3. Find "All G and VT Spot Instance Requests"
4. Request increase to at least 4 vCPUs
5. Usually approved within 24 hours

---

## Step 2: Launch EC2 Spot Instance

### 2.1 Go to EC2 Console
1. Log into AWS Console
2. Search for "EC2" in top search bar
3. Click "EC2"
4. Select your preferred region (e.g., **us-east-1** for lowest prices)

### 2.2 Launch Spot Instance

Click **"Launch Instance"** and configure:

#### **Name and Tags**
```
Name: musetalk-gpu-server
```

#### **Application and OS Images (AMI)**
- **Quick Start**: Ubuntu
- **AMI**: Ubuntu Server 22.04 LTS (Free tier eligible)
- **Architecture**: 64-bit (x86)

#### **Instance Type**
- Click "Compare instance types"
- Filter by GPU: Select "Accelerated computing"
- Choose: **g5.xlarge**
- Specs shown:
  - 4 vCPU
  - 16 GiB Memory
  - 1x NVIDIA A10G GPU (24GB)

#### **Key Pair (login)**
- Click "Create new key pair"
- Name: `musetalk-key`
- Type: RSA
- Format: `.pem` (for Mac/Linux) or `.ppk` (for Windows/PuTTY)
- **DOWNLOAD AND SAVE** - you can't download again!

#### **Network Settings**
- Create security group: `musetalk-sg`
- Allow SSH: ✅ From My IP (or Anywhere for flexibility)
- **Add Rule**: Custom TCP, Port 5000, Source: Anywhere (for API)
- **Add Rule**: Custom TCP, Port 80, Source: Anywhere (optional, for HTTP)

#### **Configure Storage**
- Size: **50 GB** (minimum)
- Type: gp3 (recommended for performance)
- Delete on termination: ✅ (save costs when done)

#### **Advanced Details** (IMPORTANT!)
Scroll down to "Purchasing option":
- ☑️ **Request Spot Instances** ← ENABLE THIS!
- Leave default settings (interruption behavior: Terminate)

Click **"Launch Instance"**

### 2.3 Wait for Instance to Start
- Status will change from "Pending" to "Running" (~1-2 minutes)
- Note the **Public IPv4 address** (e.g., 3.123.45.67)

---

## Step 3: Connect to Your EC2 Instance

### On Mac/Linux:

```bash
# Set key permissions (required!)
chmod 400 ~/Downloads/musetalk-key.pem

# Connect via SSH (replace with your IP)
ssh -i ~/Downloads/musetalk-key.pem ubuntu@YOUR_EC2_PUBLIC_IP

# Example:
ssh -i ~/Downloads/musetalk-key.pem ubuntu@3.123.45.67
```

### On Windows:

**Option A: Use PuTTY**
1. Open PuTTYgen
2. Load your .ppk key
3. Open PuTTY
4. Host: `ubuntu@YOUR_EC2_PUBLIC_IP`
5. Connection → SSH → Auth → Browse to .ppk file
6. Click "Open"

**Option B: Use Windows PowerShell/WSL**
```powershell
ssh -i C:\path\to\musetalk-key.pem ubuntu@YOUR_EC2_PUBLIC_IP
```

---

## Step 4: Install NVIDIA Drivers and CUDA

Once connected, run these commands:

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install NVIDIA drivers (for A10G)
sudo apt install -y ubuntu-drivers-common
sudo ubuntu-drivers autoinstall

# Install CUDA toolkit
wget https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2204/x86_64/cuda-keyring_1.0-1_all.deb
sudo dpkg -i cuda-keyring_1.0-1_all.deb
sudo apt update
sudo apt install -y cuda-toolkit-11-8

# Add CUDA to PATH
echo 'export PATH=/usr/local/cuda-11.8/bin:$PATH' >> ~/.bashrc
echo 'export LD_LIBRARY_PATH=/usr/local/cuda-11.8/lib64:$LD_LIBRARY_PATH' >> ~/.bashrc
source ~/.bashrc

# REBOOT (required for drivers)
sudo reboot
```

Wait ~1 minute, then reconnect:

```bash
ssh -i ~/Downloads/musetalk-key.pem ubuntu@YOUR_EC2_PUBLIC_IP
```

Verify GPU:

```bash
nvidia-smi
```

Expected output:
```
+-----------------------------------------------------------------------------+
| NVIDIA-SMI 525.x        Driver Version: 525.x        CUDA Version: 11.8    |
|-------------------------------+----------------------+----------------------+
| GPU  Name        Persistence-M| Bus-Id        Disp.A | Volatile Uncorr. ECC |
| Fan  Temp  Perf  Pwr:Usage/Cap|         Memory-Usage | GPU-Util  Compute M. |
|===============================+======================+======================|
|   0  NVIDIA A10G         Off  | 00000000:00:1E.0 Off |                    0 |
|  0%   32C    P0    31W / 300W |      0MiB / 23028MiB |      0%      Default |
+-------------------------------+----------------------+----------------------+
```

✅ If you see this, GPU is ready!

---

## Step 5: Install MuseTalk

```bash
# Install Python and dependencies
sudo apt install -y python3 python3-pip git ffmpeg

# Clone MuseTalk
cd ~
git clone https://github.com/TMElyralab/MuseTalk.git
cd MuseTalk

# Install PyTorch with CUDA support
pip3 install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118

# Install MuseTalk requirements
pip3 install -r requirements.txt

# Download model weights (~2GB, takes 5-10 minutes)
bash scripts/download_weights.sh

# Verify installation
python3 -c "import torch; print('✅ CUDA available!' if torch.cuda.is_available() else '❌ No GPU')"
```

Expected: `✅ CUDA available!`

---

## Step 6: Deploy MuseTalk API Server

```bash
# Create API directory
mkdir -p ~/musetalk-api
cd ~/musetalk-api

# Download API server files
wget https://raw.githubusercontent.com/pmenezes08/Links/main/musetalk_api_server.py
wget https://raw.githubusercontent.com/pmenezes08/Links/main/musetalk_api_requirements.txt

# Install API dependencies
pip3 install -r musetalk_api_requirements.txt

# Generate secure API secret
export MUSETALK_API_SECRET=$(openssl rand -hex 32)

# Create configuration
cat > .env << EOF
MUSETALK_PATH=/home/ubuntu/MuseTalk
OUTPUT_DIR=/home/ubuntu/musetalk-api/outputs
MUSETALK_API_SECRET=$MUSETALK_API_SECRET
PORT=5000
EOF

# Save your API secret (IMPORTANT!)
echo ""
echo "========================================"
echo "🔑 YOUR API SECRET (SAVE THIS!):"
echo "$MUSETALK_API_SECRET"
echo "========================================"
echo ""
echo "Copy this secret now - you'll need it to configure your main app!"

# Start API server
nohup python3 musetalk_api_server.py > api.log 2>&1 &

# Wait for startup
sleep 3

# Test the API
curl http://localhost:5000/health
```

Expected output:
```json
{"status": "healthy", "musetalk_available": true}
```

---

## Step 7: Configure Security Group & Access

Your API is now running on port 5000. To access it from your main app:

### Option A: Direct IP Access (Simplest)

Your API URL will be:
```
http://YOUR_EC2_PUBLIC_IP:5000
```

**Pros**: Simple, no extra services
**Cons**: IP changes if spot instance restarts

### Option B: Elastic IP (Recommended for Production)

1. Go to EC2 Console → Elastic IPs
2. Click "Allocate Elastic IP address"
3. Click "Actions" → "Associate Elastic IP address"
4. Select your instance
5. Your IP is now permanent!

**Cost**: $0/month while attached, $0.005/hour if not attached

### Option C: Load Balancer with Domain (Advanced)

For production with custom domain (api.yourdomain.com):
1. Create Application Load Balancer
2. Point to your instance
3. Configure Route53 or your DNS provider

---

## Step 8: Test from Your Main App

On your **PythonAnywhere server**:

```bash
cd ~/WorkoutX/Links

# Add to .env
cat >> .env << 'EOF'

# MuseTalk AWS API
MUSETALK_API_URL=http://YOUR_EC2_PUBLIC_IP:5000
MUSETALK_API_SECRET=your-secret-from-step-6
EOF

# Test connection
python3 << 'PYTEST'
import os
os.environ['MUSETALK_API_URL'] = 'http://YOUR_EC2_IP:5000'
os.environ['MUSETALK_API_SECRET'] = 'YOUR_SECRET'

from musetalk_integration import check_api_health
healthy, message = check_api_health()
print(f"{'✅' if healthy else '❌'} {message}")
PYTEST

# Reload app
touch /var/www/puntz08_pythonanywhere_com_wsgi.py
```

---

## Step 9: Cost Optimization - Auto-Shutdown

### Create Auto-Shutdown Script

```bash
cd ~
cat > auto_shutdown.sh << 'EOF'
#!/bin/bash
# Auto-shutdown after 2 hours of inactivity

IDLE_THRESHOLD=7200  # 2 hours in seconds
CHECK_INTERVAL=600   # Check every 10 minutes

while true; do
    # Check for recent API requests
    LAST_REQUEST=$(find /home/ubuntu/musetalk-api/outputs -type f -mmin -120 2>/dev/null | wc -l)
    
    if [ "$LAST_REQUEST" -eq 0 ]; then
        echo "$(date): No activity for 2 hours. Shutting down..."
        sudo shutdown -h now
    else
        echo "$(date): Active ($LAST_REQUEST recent files). Staying up."
    fi
    
    sleep $CHECK_INTERVAL
done
EOF

chmod +x auto_shutdown.sh

# Run in background
nohup ./auto_shutdown.sh > auto_shutdown.log 2>&1 &
```

This will automatically shut down the instance after 2 hours of no requests, saving you money!

### Create Startup Script (for Easy Restart)

```bash
cd ~
cat > start_musetalk.sh << 'EOF'
#!/bin/bash
# Quick start script for MuseTalk API

cd /home/ubuntu/musetalk-api
source .env
export $(cat .env | xargs)
nohup python3 musetalk_api_server.py > api.log 2>&1 &

echo "✅ MuseTalk API started!"
echo "Check logs: tail -f /home/ubuntu/musetalk-api/api.log"
EOF

chmod +x start_musetalk.sh
```

Now you can restart the API anytime with:
```bash
./start_musetalk.sh
```

---

## Step 10: Monitor and Manage

### Check API Status
```bash
# View logs
tail -f ~/musetalk-api/api.log

# Check if running
ps aux | grep musetalk_api_server

# GPU usage
nvidia-smi

# Disk usage
df -h
```

### Restart API
```bash
# Stop
pkill -f musetalk_api_server.py

# Start
./start_musetalk.sh
```

### Stop EC2 Instance (Save Money!)
```bash
# From your local machine:
aws ec2 stop-instances --instance-ids i-YOUR-INSTANCE-ID

# Or use AWS Console:
# EC2 → Instances → Select instance → Instance State → Stop
```

**Note**: Spot instances can't be stopped, only terminated. If you need stop/start, use on-demand.

---

## Handling Spot Instance Interruptions

Spot instances can be interrupted (terminated) with 2 minutes notice when AWS needs capacity.

### What Happens:
- AWS sends warning 2 minutes before termination
- Your instance shuts down
- **Data on EBS volume is preserved** (if not set to delete)
- You need to launch a new spot instance

### Recovery Steps:

1. **Launch New Spot Instance**
   - Use same AMI and settings
   - Attach the old EBS volume (if preserved)

2. **Or Create AMI (Snapshot) Regularly**
   ```bash
   # From local machine:
   aws ec2 create-image \
     --instance-id i-YOUR-INSTANCE-ID \
     --name "musetalk-server-$(date +%Y%m%d)"
   ```

3. **Use Launch Template** (Recommended)
   - Create a launch template with your configuration
   - One-click relaunch when interrupted

### Interruption Rate
- **g5.xlarge**: Low (~5% interruption rate in most regions)
- **Expected uptime**: 95%+ with same-day recovery

---

## Production Best Practices

### 1. Use Elastic IP
- Permanent IP address
- No config changes when restarting

### 2. Enable CloudWatch Monitoring
- Track GPU usage
- Set billing alarms

### 3. Backup Your Configuration
```bash
# Create AMI snapshot monthly
aws ec2 create-image --instance-id i-xxx --name "musetalk-backup-$(date +%Y%m%d)"
```

### 4. Use S3 for Long-Term Storage
```bash
# Install AWS CLI
sudo apt install awscli

# Upload videos to S3 (cheaper storage)
aws s3 cp /home/ubuntu/musetalk-api/outputs/ s3://your-bucket/videos/ --recursive
```

### 5. Set Up CloudWatch Alarms
- CPU > 80% for 10 minutes
- Network in/out anomalies
- Disk space < 10%

---

## Troubleshooting

### GPU Not Detected
```bash
# Check driver
nvidia-smi

# If fails, reinstall:
sudo apt install -y nvidia-driver-525
sudo reboot
```

### API Not Accessible from Internet
```bash
# Check security group allows port 5000
# AWS Console → EC2 → Security Groups → musetalk-sg
# Ensure inbound rule: TCP 5000 from 0.0.0.0/0
```

### Out of Memory
```bash
# Monitor GPU memory
watch -n 1 nvidia-smi

# If OOM, reduce batch size in musetalk_api_server.py:
# Line 93: '--batch_size', '4' → '--batch_size', '1'
```

### Spot Instance Terminated
1. Check AWS Console for termination reason
2. Launch new instance from AMI or template
3. Update MUSETALK_API_URL if IP changed (unless using Elastic IP)

---

## Cost Tracking

### View Current Spend
1. AWS Console → Billing Dashboard
2. "Bills" → Current month
3. Filter by "EC2"

### Estimate Monthly Cost
```
Spot Instance (g5.xlarge): $0.50/hour
Hours per month (24/7): 730 hours
Total: $365/month

With auto-shutdown (4h/day):
4 hours × 30 days = 120 hours
Total: $60/month
```

### Save Money:
- ✅ Use spot instances (60% cheaper)
- ✅ Auto-shutdown when idle
- ✅ Stop instance when not in use
- ✅ Use smaller storage (delete old outputs)

---

## Summary

✅ **Setup Time**: ~30-45 minutes
✅ **Cost**: $0.40-0.60/hour (spot) vs $1.00+ (on-demand)
✅ **Performance**: 10-30 seconds per video
✅ **GPU**: NVIDIA A10G (24GB) - excellent for AI
✅ **Scalability**: Easy to add more instances

**Your MuseTalk API is now running on AWS! 🚀**

---

## Quick Reference Commands

```bash
# SSH to instance
ssh -i ~/Downloads/musetalk-key.pem ubuntu@YOUR_EC2_IP

# Check API status
tail -f ~/musetalk-api/api.log

# Check GPU
nvidia-smi

# Restart API
pkill -f musetalk_api_server && ./start_musetalk.sh

# Stop instance (from local machine)
aws ec2 stop-instances --instance-ids i-YOUR-INSTANCE-ID
```

---

**Next Steps**: Follow the checklist in `MY_MUSETALK_CHECKLIST.md` to test end-to-end!
