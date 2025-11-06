# MuseTalk on RunPod - Python Version Fix

## Problem

RunPod uses Python 3.12 by default, but MuseTalk requires Python 3.10 or 3.11 due to numpy compatibility.

**Error**: `AttributeError: module 'pkgutil' has no attribute 'ImpImporter'`

---

## ✅ Solution: Use Python 3.10

### On RunPod, run these commands:

```bash
# Install Python 3.10
apt update
apt install -y python3.10 python3.10-venv python3.10-dev

# Create virtual environment with Python 3.10
cd ~/MuseTalk
python3.10 -m venv venv

# Activate it
source venv/bin/activate

# Upgrade pip
pip install --upgrade pip setuptools wheel

# Now install requirements
pip install -r requirements.txt

# Install PyTorch with CUDA 11.8
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118

# Download model weights
bash scripts/download_weights.sh
```

---

## 🚀 Complete RunPod Setup Script

Copy and paste this entire block into your RunPod terminal:

```bash
#!/bin/bash
# Complete MuseTalk setup for RunPod

echo "=== Installing Python 3.10 ==="
apt update
apt install -y python3.10 python3.10-venv python3.10-dev git ffmpeg

echo "=== Cloning MuseTalk ==="
cd ~
if [ ! -d "MuseTalk" ]; then
    git clone https://github.com/TMElyralab/MuseTalk.git
fi
cd MuseTalk

echo "=== Creating Python 3.10 Virtual Environment ==="
python3.10 -m venv venv
source venv/bin/activate

echo "=== Upgrading pip ==="
pip install --upgrade pip setuptools wheel

echo "=== Installing PyTorch with CUDA ==="
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118

echo "=== Installing MuseTalk Requirements ==="
pip install -r requirements.txt

echo "=== Verifying CUDA ==="
python -c "import torch; print('✅ CUDA available!' if torch.cuda.is_available() else '❌ No CUDA')"

echo "=== Downloading Model Weights (~2GB, may take 5-10 min) ==="
bash scripts/download_weights.sh

echo ""
echo "✅ Setup complete!"
echo ""
echo "Virtual environment is activated."
echo "To activate it later, run: source ~/MuseTalk/venv/bin/activate"
```

---

## 📋 Step-by-Step (If Script Doesn't Work)

### 1. Install Python 3.10

```bash
apt update
apt install -y python3.10 python3.10-venv python3.10-dev
```

### 2. Verify Python 3.10 is installed

```bash
python3.10 --version
# Should show: Python 3.10.x
```

### 3. Create virtual environment

```bash
cd ~/MuseTalk
python3.10 -m venv venv
source venv/bin/activate
```

Your prompt should now show `(venv)`:
```
(venv) root@xxxxx:~/MuseTalk#
```

### 4. Upgrade pip

```bash
pip install --upgrade pip setuptools wheel
```

### 5. Install PyTorch first

```bash
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118
```

### 6. Install other requirements

```bash
pip install -r requirements.txt
```

### 7. Verify CUDA works

```bash
python -c "import torch; print('CUDA available:', torch.cuda.is_available())"
```

Should show: `CUDA available: True`

### 8. Download models

```bash
bash scripts/download_weights.sh
```

---

## 🔍 Verify Everything Works

```bash
# Make sure you're in the venv
source ~/MuseTalk/venv/bin/activate

# Check Python version
python --version
# Should be: Python 3.10.x

# Check CUDA
python -c "import torch; print('CUDA:', torch.cuda.is_available())"
# Should be: CUDA: True

# Check if models downloaded
ls -lh models/dwpose/
ls -lh models/musetalk/
ls -lh models/sd-vae/
ls -lh models/whisper/
```

---

## 🚀 Deploy API Server

Once everything is installed:

```bash
# Create API directory
mkdir -p ~/musetalk-api
cd ~/musetalk-api

# Download API server files
wget https://raw.githubusercontent.com/pmenezes08/Links/main/musetalk_api_server.py
wget https://raw.githubusercontent.com/pmenezes08/Links/main/musetalk_api_requirements.txt

# Install API dependencies (use Python 3.10 venv)
source ~/MuseTalk/venv/bin/activate
pip install -r musetalk_api_requirements.txt

# Generate API secret
export MUSETALK_API_SECRET=$(openssl rand -hex 32)

# Create config
cat > .env << EOF
MUSETALK_PATH=/root/MuseTalk
OUTPUT_DIR=/root/musetalk-api/outputs
MUSETALK_API_SECRET=$MUSETALK_API_SECRET
PORT=5000
EOF

# Display your API secret (SAVE THIS!)
echo ""
echo "========================================"
echo "🔑 YOUR API SECRET (SAVE THIS!):"
echo "$MUSETALK_API_SECRET"
echo "========================================"
echo ""

# Start API server
nohup python musetalk_api_server.py > api.log 2>&1 &

# Test it
sleep 3
curl http://localhost:5000/health
```

---

## 🌐 Expose API with ngrok

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

Copy the HTTPS URL (e.g., `https://abc123.ngrok.io`)

---

## 🔧 Configure Your Main App

On your PythonAnywhere server:

```bash
cd ~/WorkoutX/Links
nano .env
```

Add these lines:

```bash
# MuseTalk RunPod API
MUSETALK_API_URL=https://your-ngrok-url
MUSETALK_API_SECRET=your-secret-from-above
```

Save and reload:

```bash
touch /var/www/puntz08_pythonanywhere_com_wsgi.py
```

---

## 🆘 Troubleshooting

### Error: "python3.10: command not found"

```bash
# Try installing from deadsnakes PPA
apt install -y software-properties-common
add-apt-repository ppa:deadsnakes/ppa
apt update
apt install -y python3.10 python3.10-venv python3.10-dev
```

### Error: Still getting numpy errors

```bash
# Make sure you're in the venv
source ~/MuseTalk/venv/bin/activate

# Check Python version
python --version
# MUST be 3.10.x, not 3.12

# If it's still 3.12, recreate venv:
deactivate
rm -rf venv
python3.10 -m venv venv
source venv/bin/activate
```

### Error: "No module named torch"

```bash
# Install PyTorch separately first
source ~/MuseTalk/venv/bin/activate
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118
```

---

## ✅ Success Checklist

- [ ] Python 3.10 installed
- [ ] Virtual environment created with Python 3.10
- [ ] PyTorch installed with CUDA support
- [ ] All requirements installed without errors
- [ ] CUDA available (torch.cuda.is_available() = True)
- [ ] Model weights downloaded
- [ ] API server running
- [ ] ngrok exposing port 5000
- [ ] Main app configured with API URL and secret

---

## 💡 Pro Tip: Auto-Activate venv

Add this to your `~/.bashrc`:

```bash
echo 'alias musetalk="cd ~/MuseTalk && source venv/bin/activate"' >> ~/.bashrc
source ~/.bashrc
```

Now you can just type `musetalk` to activate the environment!

---

## 🎉 Summary

**Problem**: RunPod uses Python 3.12, MuseTalk needs 3.10
**Solution**: Install Python 3.10 and create venv with it
**Time**: 15-20 minutes
**Result**: Working MuseTalk on RunPod GPU!

Copy the complete setup script above and run it - should work perfectly! 🚀
