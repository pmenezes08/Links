# AWS EC2 MuseTalk Setup - Complete Summary

Everything is ready for you to deploy MuseTalk on AWS EC2 g5.xlarge spot instance!

---

## 📁 Files Available

### Main Guides:
1. **`AWS_EC2_MUSETALK_SETUP.md`** - Complete step-by-step guide (RECOMMENDED)
2. **`AWS_QUICK_CHECKLIST.md`** - Quick checklist format
3. **`ec2_setup_musetalk.sh`** - Automated setup script

### Supporting Files:
- `musetalk_api_server.py` - API server code
- `musetalk_api_requirements.txt` - Dependencies
- `musetalk_integration.py` - Updated main app (already configured)

---

## 🚀 Quick Start (3 Options)

### Option 1: Follow Detailed Guide (RECOMMENDED)
```bash
# Open the guide:
cat AWS_EC2_MUSETALK_SETUP.md

# Follow all 10 steps
# Time: 30-45 minutes
# Best for first-time AWS users
```

### Option 2: Use Checklist
```bash
# Open checklist:
cat AWS_QUICK_CHECKLIST.md

# Check off items as you go
# Time: 30-45 minutes
# Good for following along
```

### Option 3: Automated Script (After EC2 Launch)
```bash
# On your EC2 instance after first login:
wget https://raw.githubusercontent.com/pmenezes08/Links/main/ec2_setup_musetalk.sh
chmod +x ec2_setup_musetalk.sh
./ec2_setup_musetalk.sh

# Time: 20-30 minutes (mostly automated)
# Requires one reboot
```

---

## 📋 Prerequisites

Before starting, you need:

- [ ] AWS account
- [ ] Payment method added
- [ ] Basic SSH knowledge
- [ ] 45 minutes of time
- [ ] $10-50 budget for testing

---

## 🎯 What You'll Get

### Hardware:
- **GPU**: NVIDIA A10G (24GB VRAM)
- **CPU**: 4 vCPUs
- **RAM**: 16GB
- **Storage**: 50GB SSD

### Performance:
- **Video Generation**: 10-30 seconds
- **Concurrent Requests**: 2-4 (with queue)
- **GPU Utilization**: 60-80%

### Cost:
- **Spot Instance**: $0.40-0.60/hour
- **Storage**: ~$5/month
- **With Auto-Shutdown**: $36-72/month

---

## 📝 Setup Steps Overview

### Part 1: AWS Console (10 min)
1. Create EC2 instance
2. Configure security groups
3. Download key pair
4. Launch spot instance

### Part 2: EC2 Server (20-30 min)
1. Connect via SSH
2. Install NVIDIA drivers & CUDA
3. Clone and install MuseTalk
4. Download model weights (2GB)
5. Deploy API server

### Part 3: Main App (5 min)
1. Update .env with API URL
2. Test connection
3. Reload app

### Part 4: Test (3 min)
1. Generate talking avatar
2. Verify video quality
3. Check logs

---

## 🔧 Configuration Details

### Security Group (Port Configuration):
```
SSH (22):         Your IP or Anywhere
API (5000):       Anywhere (0.0.0.0/0)
Optional HTTP (80): Anywhere
```

### Environment Variables (.env on PythonAnywhere):
```bash
MUSETALK_API_URL=http://YOUR_EC2_IP:5000
MUSETALK_API_SECRET=your-generated-secret
```

### EC2 Instance Settings:
```
Instance Type: g5.xlarge
AMI: Ubuntu 22.04 LTS
Storage: 50GB gp3
Purchasing: Spot Instance (✓)
```

---

## 💰 Cost Management

### Save Money:
1. **Use Spot Instances**: 60% cheaper than on-demand
2. **Auto-Shutdown**: Shut down after 2 hours idle
3. **Stop When Not Needed**: Stop instance overnight
4. **Elastic IP**: Only $0 when attached

### Monitor Costs:
```bash
# AWS Console → Billing Dashboard
# Set up budget alerts ($50-100/month)
# Review EC2 costs weekly
```

### Estimated Monthly Costs:
- **24/7 Uptime**: $288-432
- **8 Hours/Day**: $96-144
- **4 Hours/Day**: $48-72
- **2 Hours/Day**: $24-36

---

## 🔍 Verification Checklist

After setup, verify:

### On EC2:
```bash
# GPU detected
nvidia-smi  # Should show NVIDIA A10G

# API running
curl http://localhost:5000/health  # Should return healthy

# API logs
tail -f ~/musetalk-api/api.log  # Should show startup messages
```

### From PythonAnywhere:
```bash
# Test connection
python3 -c "
import os
os.environ['MUSETALK_API_URL'] = 'http://YOUR_EC2_IP:5000'
os.environ['MUSETALK_API_SECRET'] = 'YOUR_SECRET'
from musetalk_integration import check_api_health
print(check_api_health())
"

# Expected: (True, 'API healthy')
```

### In Your App:
- Upload test image and audio
- Generate talking avatar
- Video should render in 10-30 seconds
- Check quality and lip sync

---

## 🆘 Common Issues & Solutions

### Issue 1: Can't Connect to EC2
**Symptom**: SSH connection refused or timeout

**Solution**:
```bash
# Check security group allows SSH (port 22)
# Verify key permissions: chmod 400 musetalk-key.pem
# Try: ssh -v for verbose output
```

### Issue 2: GPU Not Detected
**Symptom**: `nvidia-smi` command not found

**Solution**:
```bash
# Verify instance type is g5.xlarge
# Reinstall drivers:
sudo ubuntu-drivers autoinstall
sudo reboot
```

### Issue 3: API Not Accessible
**Symptom**: Can't reach API from main app

**Solution**:
```bash
# Check security group allows port 5000
# Test locally: curl http://localhost:5000/health
# Check firewall: sudo ufw status
```

### Issue 4: Out of Memory
**Symptom**: API crashes or timeouts

**Solution**:
```bash
# Edit musetalk_api_server.py line 93
# Change batch_size from 4 to 1
# Restart API
```

### Issue 5: Spot Instance Terminated
**Symptom**: Instance stops unexpectedly

**Solution**:
```bash
# Launch new spot instance (same config)
# Or switch to on-demand for critical periods
# Update .env with new IP (if not using Elastic IP)
```

---

## 📊 Performance Benchmarks

### Expected Performance:
- **Video Generation**: 10-30 seconds (depends on length)
- **GPU Memory Usage**: 8-12GB / 24GB
- **CPU Usage**: 30-60%
- **Network Upload**: 5-20MB per request
- **Network Download**: 10-50MB per response

### Optimization Tips:
- Use batch_size=4 for faster processing
- Enable float16 for memory efficiency
- Clean up old outputs regularly
- Monitor GPU temperature (nvidia-smi)

---

## 🎓 Next Steps After Setup

### Immediate (Day 1):
1. ✅ Complete setup following guide
2. ✅ Test with 3-5 sample videos
3. ✅ Configure auto-shutdown
4. ✅ Set up billing alerts

### Short-term (Week 1):
1. Monitor costs daily
2. Test different image/audio combinations
3. Optimize batch size for your use case
4. Create Elastic IP for permanent access

### Long-term (Month 1):
1. Create AMI snapshot for backup
2. Set up CloudWatch monitoring
3. Consider multiple instances for scaling
4. Implement S3 storage for old videos

---

## 📞 Support Resources

### AWS Documentation:
- EC2 Spot Instances: https://aws.amazon.com/ec2/spot/
- GPU Instances: https://aws.amazon.com/ec2/instance-types/g5/
- Security Groups: https://docs.aws.amazon.com/vpc/latest/userguide/VPC_SecurityGroups.html

### MuseTalk Resources:
- GitHub: https://github.com/TMElyralab/MuseTalk
- Your API Server: `http://YOUR_EC2_IP:5000/health`

### Troubleshooting:
- Check logs: `tail -f ~/musetalk-api/api.log`
- GPU status: `nvidia-smi`
- AWS Support: https://console.aws.amazon.com/support/

---

## ✅ Pre-Flight Checklist

Before you start, make sure you have:

- [ ] AWS account created
- [ ] Payment method verified
- [ ] Basic terminal/SSH knowledge
- [ ] Text editor for .env file
- [ ] 45 minutes available
- [ ] Read AWS_EC2_MUSETALK_SETUP.md

---

## 🚀 Ready to Start?

### Step 1: Pull Latest Code
```bash
cd ~/WorkoutX/Links
git pull origin main
```

### Step 2: Open the Guide
```bash
cat AWS_EC2_MUSETALK_SETUP.md
# Or view on GitHub
```

### Step 3: Start Setup!
Follow the guide step-by-step. It's designed to be beginner-friendly with clear instructions and troubleshooting.

---

## 🎉 What You'll Achieve

After completing this setup:

- ✅ Professional AI infrastructure on AWS
- ✅ Fast, GPU-powered talking avatars
- ✅ Scalable solution that grows with you
- ✅ Cost-effective with spot pricing
- ✅ Full control over your AI stack

**Total Setup Time**: 30-45 minutes
**Monthly Cost**: $36-432 (depending on usage)
**Performance**: 10-30 seconds per video

---

## 💡 Pro Tips

1. **Start with manual setup** (not script) to understand each step
2. **Use Elastic IP** if you'll keep instance running
3. **Create AMI snapshot** after successful setup
4. **Monitor costs weekly** in first month
5. **Test auto-shutdown** to ensure it works

---

**Good luck with your AWS setup! 🚀**

Questions? All answers are in `AWS_EC2_MUSETALK_SETUP.md`
