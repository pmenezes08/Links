# MuseTalk Installation Guide

## Overview
MuseTalk is a local, offline talking head generation system. No API keys, no costs, works with any image including cartoons!

## Installation Steps

### 1. Install MuseTalk
```bash
cd /workspace
chmod +x install_musetalk.sh
./install_musetalk.sh
```

### 2. Download Model Weights
MuseTalk requires pre-trained models. Download from:
```bash
cd /workspace/MuseTalk/models

# Download required models (run these commands)
wget https://huggingface.co/TMElyralab/MuseTalk/resolve/main/musetalk.pth
wget https://huggingface.co/TMElyralab/MuseTalk/resolve/main/dwpose_s_256x192.pth
wget https://huggingface.co/TMElyralab/MuseTalk/resolve/main/face_parsing.pth

# Or use git-lfs
git lfs install
git clone https://huggingface.co/TMElyralab/MuseTalk models_temp
mv models_temp/* .
rm -rf models_temp
```

### 3. Verify Installation
```bash
python musetalk_integration.py
```

Should output: `✅ MuseTalk is ready!`

### 4. Set Environment Variables (Optional)
```bash
# In PythonAnywhere Web tab > Environment variables
MUSETALK_ENABLED=true
MUSETALK_DEVICE=cpu  # Use 'cuda' if GPU available
MUSETALK_BATCH_SIZE=8
```

### 5. Restart Flask App
Reload your web app in PythonAnywhere.

## Usage

### Creating Talking Avatar Videos
1. Go to your community
2. Click "Talking Avatar" button
3. Record or upload audio
4. Choose image (ANY image - photos, cartoons, drawings!)
5. MuseTalk generates video locally

## Benefits vs D-ID

| Feature | D-ID | MuseTalk |
|---------|------|----------|
| **Cost** | $$ per video | Free |
| **Speed** | ~30s (API + download) | ~10-20s (local) |
| **Cartoons** | ❌ Not supported | ✅ Works! |
| **File limits** | 10MB max | No limit |
| **Privacy** | Uploads to cloud | 100% local |
| **Offline** | ❌ Needs internet | ✅ Works offline |

## Troubleshooting

### "MuseTalk not installed"
Run `./install_musetalk.sh` again

### "Model weights not found"
Download models to `/workspace/MuseTalk/models/`

### "Out of memory"
- Reduce MUSETALK_BATCH_SIZE (try 4 or 2)
- Use smaller images
- Close other processes

### "Generation too slow"
- Use GPU if available (set MUSETALK_DEVICE=cuda)
- Reduce video resolution
- Increase MUSETALK_BATCH_SIZE (if have RAM)

## Technical Details

- **Framework**: PyTorch
- **Input**: Any image + audio file
- **Output**: MP4 video with lip sync
- **Processing**: 10-30 seconds depending on hardware
- **Memory**: ~2-4GB RAM typical
- **GPU**: Optional but recommended for speed

## Next Steps

Once installed, MuseTalk will automatically handle all talking avatar requests. No code changes needed!
