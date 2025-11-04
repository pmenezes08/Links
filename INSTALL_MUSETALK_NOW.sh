#!/bin/bash
# MuseTalk Installation Script for PythonAnywhere
# Run this on your server: bash INSTALL_MUSETALK_NOW.sh

set -e  # Exit on error

echo "================================================"
echo "MuseTalk Installation for PythonAnywhere"
echo "================================================"
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

# Step 4: Install dependencies
echo ""
echo "Step 4: Installing Python dependencies (this will take 5-10 minutes)..."
pip3 install --user torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu
pip3 install --user diffusers accelerate transformers opencv-python soundfile librosa einops omegaconf moviepy pyyaml gdown

# Step 5: Download model weights
echo ""
echo "Step 5: Downloading model weights (7.7 GB, will take 10-20 minutes)..."
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

# Step 6: Verify installation
echo ""
echo "Step 6: Verifying installation..."
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
