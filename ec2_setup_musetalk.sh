#!/bin/bash
# Automated MuseTalk Setup for AWS EC2 g5.xlarge
# Run this script on your EC2 instance after first login

set -e

echo "=================================================="
echo "MuseTalk API Server Setup for AWS EC2"
echo "=================================================="
echo ""
echo "This script will:"
echo "  1. Install NVIDIA drivers and CUDA"
echo "  2. Clone and install MuseTalk"
echo "  3. Download model weights (~2GB)"
echo "  4. Deploy MuseTalk API server"
echo "  5. Configure auto-startup"
echo ""
echo "Estimated time: 20-30 minutes"
echo "Internet usage: ~3-4GB download"
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo "=== STEP 1: Update System ==="
sudo apt update && sudo apt upgrade -y

echo ""
echo "=== STEP 2: Install NVIDIA Drivers ==="
sudo apt install -y ubuntu-drivers-common
sudo ubuntu-drivers autoinstall

echo ""
echo "=== STEP 3: Install CUDA Toolkit ==="
if [ ! -f cuda-keyring_1.0-1_all.deb ]; then
    wget https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2204/x86_64/cuda-keyring_1.0-1_all.deb
fi
sudo dpkg -i cuda-keyring_1.0-1_all.deb
sudo apt update
sudo apt install -y cuda-toolkit-11-8

echo ""
echo "=== STEP 4: Configure PATH ==="
if ! grep -q "cuda-11.8" ~/.bashrc; then
    echo 'export PATH=/usr/local/cuda-11.8/bin:$PATH' >> ~/.bashrc
    echo 'export LD_LIBRARY_PATH=/usr/local/cuda-11.8/lib64:$LD_LIBRARY_PATH' >> ~/.bashrc
fi
export PATH=/usr/local/cuda-11.8/bin:$PATH
export LD_LIBRARY_PATH=/usr/local/cuda-11.8/lib64:$LD_LIBRARY_PATH

echo ""
echo "=== STEP 5: Install Python Dependencies ==="
sudo apt install -y python3 python3-pip git ffmpeg

echo ""
echo "=== STEP 6: Clone MuseTalk ==="
if [ ! -d "$HOME/MuseTalk" ]; then
    cd ~
    git clone https://github.com/TMElyralab/MuseTalk.git
else
    echo "MuseTalk already cloned, skipping..."
fi

echo ""
echo "=== STEP 7: Install PyTorch with CUDA ==="
pip3 install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118

echo ""
echo "=== STEP 8: Install MuseTalk Requirements ==="
cd ~/MuseTalk
pip3 install -r requirements.txt

echo ""
echo "=== STEP 9: Download Model Weights (~2GB, may take 5-10 min) ==="
if [ ! -f "models/dwpose/dw-ll_ucoco_384.pth" ]; then
    bash scripts/download_weights.sh
else
    echo "Models already downloaded, skipping..."
fi

echo ""
echo "=== STEP 10: Verify CUDA Installation ==="
echo "NOTE: This requires a reboot to load NVIDIA drivers!"
echo "After reboot, verify with: nvidia-smi"

echo ""
echo "=== STEP 11: Create API Server Directory ==="
mkdir -p ~/musetalk-api
cd ~/musetalk-api

echo ""
echo "=== STEP 12: Download API Server Files ==="
if [ ! -f musetalk_api_server.py ]; then
    wget https://raw.githubusercontent.com/pmenezes08/Links/main/musetalk_api_server.py
fi
if [ ! -f musetalk_api_requirements.txt ]; then
    wget https://raw.githubusercontent.com/pmenezes08/Links/main/musetalk_api_requirements.txt
fi

echo ""
echo "=== STEP 13: Install API Dependencies ==="
pip3 install -r musetalk_api_requirements.txt

echo ""
echo "=== STEP 14: Generate API Secret ==="
API_SECRET=$(openssl rand -hex 32)

echo ""
echo "=== STEP 15: Create Configuration ==="
cat > .env << EOF
MUSETALK_PATH=/home/ubuntu/MuseTalk
OUTPUT_DIR=/home/ubuntu/musetalk-api/outputs
MUSETALK_API_SECRET=$API_SECRET
PORT=5000
EOF

echo ""
echo "=== STEP 16: Create Startup Script ==="
cat > start_musetalk.sh << 'EOF'
#!/bin/bash
cd /home/ubuntu/musetalk-api
source .env
export $(cat .env | xargs)
nohup python3 musetalk_api_server.py > api.log 2>&1 &
echo "✅ MuseTalk API started!"
echo "Check logs: tail -f /home/ubuntu/musetalk-api/api.log"
EOF
chmod +x start_musetalk.sh

echo ""
echo "=== STEP 17: Create Auto-Shutdown Script ==="
cat > ~/auto_shutdown.sh << 'EOF'
#!/bin/bash
# Auto-shutdown after 2 hours of inactivity
IDLE_THRESHOLD=7200
CHECK_INTERVAL=600

while true; do
    RECENT=$(find /home/ubuntu/musetalk-api/outputs -type f -mmin -120 2>/dev/null | wc -l)
    if [ "$RECENT" -eq 0 ]; then
        echo "$(date): No activity for 2 hours. Shutting down..."
        sudo shutdown -h now
    else
        echo "$(date): Active ($RECENT recent files)"
    fi
    sleep $CHECK_INTERVAL
done
EOF
chmod +x ~/auto_shutdown.sh

echo ""
echo "=================================================="
echo "✅ Setup Complete!"
echo "=================================================="
echo ""
echo "IMPORTANT: You must REBOOT to load NVIDIA drivers!"
echo ""
echo "After reboot:"
echo "  1. Verify GPU: nvidia-smi"
echo "  2. Start API: cd ~/musetalk-api && ./start_musetalk.sh"
echo "  3. Test API: curl http://localhost:5000/health"
echo ""
echo "Your API Secret (SAVE THIS!):"
echo "========================================"
echo "$API_SECRET"
echo "========================================"
echo ""
echo "Save this secret to configure your main app!"
echo ""
echo "Optional: Start auto-shutdown (saves money):"
echo "  nohup ~/auto_shutdown.sh > ~/auto_shutdown.log 2>&1 &"
echo ""
read -p "Reboot now? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Rebooting in 5 seconds..."
    sleep 5
    sudo reboot
else
    echo "Reboot manually when ready: sudo reboot"
fi
