#!/bin/bash
# Cleanup MuseTalk Local Installation
# Removes all MuseTalk files and dependencies to free disk space

set -e

echo "=================================================="
echo "MuseTalk Local Installation Cleanup"
echo "=================================================="
echo ""
echo "This will remove:"
echo "  - MuseTalk directory and models (~2-5GB)"
echo "  - MuseTalk virtual environment (~1-2GB)"
echo "  - Heavy ML dependencies (PyTorch, mmcv, etc.)"
echo "  - Model weight files"
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo "Starting cleanup..."
echo ""

# Show disk usage before
echo "=== Disk Usage BEFORE ==="
df -h | grep -E '(Filesystem|/dev/)'
echo ""

# 1. Remove MuseTalk directory
echo "📁 Removing MuseTalk directory..."
if [ -d "MuseTalk" ]; then
    du -sh MuseTalk
    rm -rf MuseTalk
    echo "✅ MuseTalk directory removed"
else
    echo "⏭️  MuseTalk directory not found"
fi
echo ""

# 2. Remove MuseTalk virtual environment
echo "📁 Removing MuseTalk virtual environment..."
if [ -d "musetalk_env" ]; then
    du -sh musetalk_env
    rm -rf musetalk_env
    echo "✅ musetalk_env removed"
else
    echo "⏭️  musetalk_env not found"
fi
echo ""

# 3. Uninstall heavy ML packages (user-installed)
echo "📦 Uninstalling heavy ML packages..."

# List of packages to remove
PACKAGES=(
    "torch"
    "torchvision" 
    "torchaudio"
    "mmcv"
    "mmcv-lite"
    "mmcv-full"
    "mmpose"
    "mmdet"
    "mmengine"
    "diffusers"
    "transformers"
    "accelerate"
    "safetensors"
    "huggingface-hub"
)

for pkg in "${PACKAGES[@]}"; do
    if pip3 show "$pkg" &> /dev/null; then
        echo "  Uninstalling $pkg..."
        pip3 uninstall -y "$pkg" 2>/dev/null || echo "    (already removed)"
    fi
done
echo "✅ Heavy packages uninstalled"
echo ""

# 4. Clean pip cache
echo "🧹 Cleaning pip cache..."
pip3 cache purge 2>/dev/null || echo "⏭️  pip cache already clean"
echo ""

# 5. Remove any downloaded model files in home directory
echo "📁 Checking for stray model files..."
MODEL_FILES=(
    "dw-ll_ucoco_384.pth"
    "79999_iter.pth"
    "resnet18-5c106cde.pth"
    "config.json"
    "unet.pth"
    "pytorch_model.bin"
    "diffusion_pytorch_model.bin"
)

for file in "${MODEL_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "  Removing $file"
        rm -f "$file"
    fi
done
echo "✅ Stray files cleaned"
echo ""

# 6. Show what ML packages remain (should keep essential ones)
echo "=== Remaining ML Packages ==="
echo "Keeping these (needed by app):"
pip3 list | grep -iE "(numpy|opencv|pil|scikit|scipy|matplotlib)" || echo "  (none found)"
echo ""

# Show disk usage after
echo "=== Disk Usage AFTER ==="
df -h | grep -E '(Filesystem|/dev/)'
echo ""

# Calculate space freed
echo "=================================================="
echo "✅ Cleanup Complete!"
echo "=================================================="
echo ""
echo "Freed up space by removing:"
echo "  ✅ MuseTalk models and code"
echo "  ✅ Virtual environment"
echo "  ✅ PyTorch and ML dependencies"
echo ""
echo "Your app will now use the GPU API for talking avatars."
echo "Make sure MUSETALK_API_URL and MUSETALK_API_SECRET are set in .env"
echo ""
