#!/bin/bash
# MuseTalk Installation Script - CPU ONLY (smaller download)
# Run this on your server: bash INSTALL_MUSETALK_CPU_ONLY.sh

set -e  # Exit on error

echo "================================================"
echo "MuseTalk Installation - CPU Only Version"
echo "================================================"
echo ""

# Clean up any failed installation
echo "Cleaning up any failed installations..."
pip3 cache purge 2>/dev/null || true

# Check disk usage
echo "Current disk usage:"
df -h /home/puntz08 | tail -1
du -sh ~/.cache/pip 2>/dev/null || echo "No pip cache"
echo ""

# Step 1: Go to Links directory
echo "Step 1: Navigating to Links directory..."
cd /home/puntz08/dev/Links
pwd

# Step 2: Pull latest code
echo ""
echo "Step 2: Pulling latest code from develop branch..."
git pull origin develop

# Step 3: Clone MuseTalk
echo ""
echo "Step 3: Cloning MuseTalk repository..."
if [ -d "MuseTalk" ]; then
    echo "MuseTalk directory already exists, skipping..."
else
    git clone https://github.com/TMElyralab/MuseTalk.git
fi

# Step 4: Install PyTorch CPU ONLY (smaller, no CUDA)
echo ""
echo "Step 4: Installing PyTorch CPU-ONLY (this is smaller - ~200MB instead of 4GB)..."
pip3 install --user --no-cache-dir torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu

# Step 5: Install other dependencies
echo ""
echo "Step 5: Installing other dependencies..."
pip3 install --user --no-cache-dir diffusers accelerate transformers opencv-python-headless soundfile librosa einops omegaconf pyyaml gdown

# Step 6: Install moviepy separately (sometimes problematic)
echo ""
echo "Step 6: Installing moviepy..."
pip3 install --user --no-cache-dir moviepy || echo "Warning: moviepy installation failed, continuing..."

# Step 7: Download model weights
echo ""
echo "Step 7: Downloading model weights (7.7 GB, will take 10-20 minutes)..."
cd /home/puntz08/dev/Links/MuseTalk

# Add local bin to PATH
export PATH="/home/puntz08/.local/bin:$PATH"

# Create model directories
mkdir -p models/musetalk models/whisper models/sd-vae models/face-parse-bisent

echo "  - Downloading MuseTalk models (6.4 GB)..."
huggingface-cli download TMElyralab/MuseTalk --local-dir ./models/musetalk

echo "  - Downloading Whisper (581 MB)..."
huggingface-cli download openai/whisper-tiny --local-dir ./models/whisper

echo "  - Downloading SD-VAE (639 MB)..."
huggingface-cli download stabilityai/sd-vae-ft-mse --local-dir ./models/sd-vae

echo "  - Downloading Face parsing models (90 MB)..."
gdown 154JgKpzCPW82qINcVieuPH3fZ2e0P812 -O models/face-parse-bisent/79999_iter.pth
curl -L https://download.pytorch.org/models/resnet18-5c106cde.pth -o models/face-parse-bisent/resnet18-5c106cde.pth

# Step 8: Verify installation
echo ""
echo "Step 8: Verifying installation..."
cd /home/puntz08/dev/Links
python3 musetalk_integration.py

# Success!
echo ""
echo "================================================"
echo "? MuseTalk Installation Complete!"
echo "================================================"
echo ""
echo "Next steps:"
echo "1. Go to PythonAnywhere Web tab"
echo "2. Click the green 'Reload' button"
echo "3. Test talking avatar in your app!"
echo ""
echo "Expected generation time: 1-3 minutes per video"
echo "================================================"
