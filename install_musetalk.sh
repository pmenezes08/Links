#!/bin/bash
set -e

echo "Installing MuseTalk..."

# Install MuseTalk dependencies
pip install --upgrade pip

# Install PyTorch (CPU version for servers without GPU)
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu

# Install MuseTalk requirements
pip install opencv-python pillow numpy scipy librosa soundfile tqdm pydub

# Clone MuseTalk repository
if [ ! -d "MuseTalk" ]; then
    git clone https://github.com/TMElyralab/MuseTalk.git
    cd MuseTalk
else
    cd MuseTalk
    git pull
fi

# Download models
mkdir -p models
cd models

# Download required model weights
echo "Downloading MuseTalk models (this may take a while)..."
# These will be downloaded from HuggingFace or their release page

cd ../..
echo "MuseTalk installation complete!"
