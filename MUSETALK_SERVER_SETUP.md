# MuseTalk Server Setup Guide

## ?? Important Requirements

### Storage Requirements
- **7.7 GB** for model weights
- Additional space for temporary files during inference

### Memory Requirements
- **Minimum 8 GB RAM** for CPU inference
- **16 GB RAM** recommended for smooth operation

### Performance
- **CPU inference**: 1-3 minutes per 10-second video
- **GPU inference (CUDA)**: 10-30 seconds per 10-second video

## Installation Steps for PythonAnywhere Server

### 1. Check Available Space
```bash
cd /home/puntz08/dev/Links
df -h .
```

### 2. Clone MuseTalk Repository
```bash
cd /home/puntz08/dev/Links
git clone https://github.com/TMElyralab/MuseTalk.git
```

### 3. Install Dependencies
```bash
# Install PyTorch (CPU version for PythonAnywhere)
pip3 install --user torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu

# Install other dependencies
pip3 install --user diffusers accelerate transformers opencv-python soundfile librosa einops omegaconf moviepy pyyaml
```

### 4. Download Model Weights
```bash
cd /home/puntz08/dev/Links/MuseTalk

# Add local bin to PATH
export PATH="/home/puntz08/.local/bin:$PATH"

# Download all models (this will take 10-15 minutes)
# MuseTalk models
huggingface-cli download TMElyralab/MuseTalk --local-dir ./models/musetalk

# Whisper
huggingface-cli download openai/whisper-tiny --local-dir ./models/whisper

# SD-VAE
huggingface-cli download stabilityai/sd-vae-ft-mse --local-dir ./models/sd-vae

# Face parsing
gdown 154JgKpzCPW82qINcVieuPH3fZ2e0P812 -O models/face-parse-bisent/79999_iter.pth
curl -L https://download.pytorch.org/models/resnet18-5c106cde.pth -o models/face-parse-bisent/resnet18-5c106cde.pth
```

### 5. Verify Installation
```bash
cd /home/puntz08/dev/Links
python3 musetalk_integration.py
```

Should output: `? MuseTalk is ready!`

### 6. Update Flask App
Make sure your `bodybuilding_app.py` has the MuseTalk integration (already done in git).

### 7. Restart Flask Application
```bash
# On PythonAnywhere, reload your web app from the Web tab
# Or restart the WSGI process
```

## Testing

1. Go to your app
2. Upload an image (any face - real photo or cartoon)
3. Record audio
4. Click "Generate Talking Avatar"
5. Wait 1-3 minutes for CPU processing
6. Video will appear in the feed

## Troubleshooting

### "No space left on device"
- PythonAnywhere free tier has limited space
- Consider upgrading or using a different server

### "Out of memory"
- MuseTalk requires at least 8GB RAM
- Free PythonAnywhere accounts may not have enough
- Consider using Hetzner Cloud or similar (~$5/month)

### Inference is very slow
- CPU inference is slow (normal)
- For faster generation:
  - Use a server with GPU (NVIDIA)
  - Set `MUSETALK_DEVICE=cuda` in environment
  - Expect 10-30 second generation instead of minutes

## Alternative: Use Cheaper Cloud GPU

If PythonAnywhere doesn't have enough resources, consider:

1. **Hetzner Cloud** (~$5-10/month with GPU)
2. **Linode** (~$10/month with 4GB RAM)
3. **DigitalOcean** (~$12/month with 8GB RAM)
4. **RunPod** (serverless GPU, pay per use ~$0.30/hour)

## Current Configuration

Your app is configured to use:
- Device: CPU (set `MUSETALK_DEVICE=cuda` for GPU)
- Batch size: 8
- Auto-enabled when MuseTalk is installed

## Files Updated

- ? `bodybuilding_app.py` - MuseTalk integration
- ? `musetalk_integration.py` - Wrapper for MuseTalk
- ? `requirements.txt` - Added PyYAML
- ? `MuseTalk/` - Repository with models (7.7GB)
